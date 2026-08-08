import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	approxBase64Bytes,
	buildMonthlyWorkbook,
	buildSectionedWorkbook,
	formatLocalTimestamp,
	formatMoneyCents,
	getMonthNames,
	monthIndexFromYmd,
	monthIndexInTz,
	safeSheetName,
	yearInTz,
} from "./exportHelpers";
import { insertMenuForRestaurant } from "./menus";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// ============================================================================
// Pure helper tests
// ============================================================================

describe("formatMoneyCents", () => {
	it("formats positive cents with two decimal places", () => {
		expect(formatMoneyCents(1234)).toBe("12.34");
		expect(formatMoneyCents(5)).toBe("0.05");
		expect(formatMoneyCents(0)).toBe("0.00");
	});

	it("preserves the sign for negative cents", () => {
		expect(formatMoneyCents(-1234)).toBe("-12.34");
		expect(formatMoneyCents(-5)).toBe("-0.05");
	});

	it("returns empty string for null/undefined", () => {
		expect(formatMoneyCents(null)).toBe("");
		expect(formatMoneyCents(undefined)).toBe("");
	});
});

describe("monthIndexFromYmd", () => {
	it("returns the right zero-based month for a matching year", () => {
		expect(monthIndexFromYmd("2026-01-15", 2026)).toBe(0);
		expect(monthIndexFromYmd("2026-12-31", 2026)).toBe(11);
	});

	it("returns null when the year does not match", () => {
		expect(monthIndexFromYmd("2025-06-15", 2026)).toBeNull();
	});

	it("returns null for malformed keys", () => {
		expect(monthIndexFromYmd("not-a-date", 2026)).toBeNull();
		expect(monthIndexFromYmd("", 2026)).toBeNull();
		expect(monthIndexFromYmd(undefined, 2026)).toBeNull();
	});
});

describe("monthIndexInTz", () => {
	it("buckets near-midnight timestamps into the correct local month", () => {
		// 2026-06-30 22:30 New York local = 2026-07-01 02:30 UTC. The export
		// for June must include this row when bucketed in restaurant-local time.
		const localNYJun30Late = Date.UTC(2026, 6, 1, 2, 30, 0, 0); // July 1 02:30 UTC
		expect(monthIndexInTz(localNYJun30Late, 2026, "America/New_York")).toBe(5); // June
		// Same instant interpreted in UTC lands in July.
		expect(monthIndexInTz(localNYJun30Late, 2026, "UTC")).toBe(6);
	});

	it("returns null for a year mismatch", () => {
		const t = Date.UTC(2025, 11, 15, 12, 0, 0, 0);
		expect(monthIndexInTz(t, 2026, "UTC")).toBeNull();
	});

	it("returns null for null/undefined", () => {
		expect(monthIndexInTz(undefined, 2026, "UTC")).toBeNull();
		expect(monthIndexInTz(null, 2026, "UTC")).toBeNull();
	});
});

describe("yearInTz", () => {
	it("returns the calendar year in the given timezone", () => {
		// 2026-01-01 04:00 UTC = 2025-12-31 23:00 New York → year 2025
		const ms = Date.UTC(2026, 0, 1, 4, 0, 0, 0);
		expect(yearInTz(ms, "America/New_York")).toBe(2025);
		expect(yearInTz(ms, "UTC")).toBe(2026);
	});
});

describe("formatLocalTimestamp", () => {
	it("formats epoch ms as YYYY-MM-DD HH:mm in given timezone", () => {
		const ms = Date.UTC(2026, 5, 15, 14, 30, 0, 0);
		expect(formatLocalTimestamp(ms, "UTC")).toBe("2026-06-15 14:30");
	});

	it("returns empty string for null/undefined", () => {
		expect(formatLocalTimestamp(null, "UTC")).toBe("");
		expect(formatLocalTimestamp(undefined, "UTC")).toBe("");
	});
});

describe("getMonthNames", () => {
	it("returns 12 localized names", () => {
		const en = getMonthNames("en");
		expect(en).toHaveLength(12);
		expect(en[0]).toMatch(/jan/i);
		expect(en[11]).toMatch(/dec/i);

		const es = getMonthNames("es");
		expect(es).toHaveLength(12);
		// "Enero" or "enero" depending on the Intl backend; just assert non-empty.
		expect(es[0].length).toBeGreaterThan(0);
	});
});

describe("safeSheetName", () => {
	it("strips illegal Excel sheet characters", () => {
		expect(safeSheetName("foo/bar")).toBe("foo bar");
		expect(safeSheetName("foo:bar?baz")).toBe("foo bar baz");
		expect(safeSheetName("[brackets]")).toBe("brackets");
	});

	it("truncates to 31 characters", () => {
		const long = "a".repeat(50);
		expect(safeSheetName(long).length).toBe(31);
	});

	it("falls back to 'Sheet' when the cleaned name is empty", () => {
		expect(safeSheetName("///")).toBe("Sheet");
	});
});

describe("approxBase64Bytes", () => {
	it("approximates the byte size of base64", () => {
		// 4 base64 chars → 3 bytes. With one '=' pad → 2 bytes. With '==' → 1 byte.
		expect(approxBase64Bytes("YWJj")).toBe(3); // "abc"
		expect(approxBase64Bytes("YWI=")).toBe(2); // "ab"
		expect(approxBase64Bytes("YQ==")).toBe(1); // "a"
		expect(approxBase64Bytes("")).toBe(0);
	});
});

// ============================================================================
// Workbook builder tests
// ============================================================================

describe("buildMonthlyWorkbook", () => {
	interface Row {
		readonly idx: number;
		readonly name: string;
	}

	const headers = ["idx", "name"];
	const mapRow = (r: Row) => [r.idx, r.name];

	const monthlySheets = Array.from({ length: 12 }, (_, i) => ({
		monthIndex: i,
		sheetName: `Month ${i + 1}`,
		rows: i === 5 ? [{ idx: 1, name: "first" } as Row] : [],
	}));

	it("emits Summary + 12 monthly sheets", () => {
		const base64 = buildMonthlyWorkbook({
			monthlySheets,
			headers,
			mapRow,
			summary: { name: "Summary", headers: ["m", "n"], rows: [["x", 1]] },
		});
		const buf = Buffer.from(base64, "base64");
		const wb = XLSX.read(buf, { type: "buffer" });
		expect(wb.SheetNames).toHaveLength(13);
		expect(wb.SheetNames[0]).toBe("Summary");
	});

	it("populates empty months with a header-only sheet", () => {
		const base64 = buildMonthlyWorkbook({
			monthlySheets,
			headers,
			mapRow,
		});
		const buf = Buffer.from(base64, "base64");
		const wb = XLSX.read(buf, { type: "buffer" });
		const emptySheet = wb.Sheets["Month 1"];
		const rows = XLSX.utils.sheet_to_json<string[]>(emptySheet, { header: 1 });
		// Just a header row in the empty month.
		expect(rows).toHaveLength(1);
		expect(rows[0]).toEqual(["idx", "name"]);

		const populated = wb.Sheets["Month 6"];
		const popRows = XLSX.utils.sheet_to_json<string[]>(populated, { header: 1 });
		expect(popRows).toHaveLength(2);
	});
});

describe("buildSectionedWorkbook", () => {
	it("emits one sheet per section", () => {
		const base64 = buildSectionedWorkbook([
			{ name: "A", headers: ["x"], rows: [{ x: 1 }], mapRow: (r) => [(r as { x: number }).x] },
			{ name: "B", headers: ["y"], rows: [{ y: 2 }], mapRow: (r) => [(r as { y: number }).y] },
		]);
		const wb = XLSX.read(Buffer.from(base64, "base64"), { type: "buffer" });
		expect(wb.SheetNames).toEqual(["A", "B"]);
	});
});

// ============================================================================
// Convex integration tests
// ============================================================================

async function seedRestaurant(
	t: ReturnType<typeof convexTest>,
	opts: { ownerId: string; createdAt?: number; timezone?: string }
): Promise<{ orgId: Id<"organizations">; restaurantId: Id<"restaurants"> }> {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const orgId = await ctx.db.insert("organizations", {
			name: "Export Org",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: opts.ownerId,
			organizationId: orgId,
			name: "Export R",
			slug: "export-r",
			currency: "USD",
			timezone: opts.timezone,
			isActive: true,
			createdAt: opts.createdAt ?? now,
			updatedAt: now,
		});
		await insertMenuForRestaurant(ctx, {
			restaurantId,
			name: "main",
			userId: opts.ownerId,
		});
		return { orgId, restaurantId };
	});
}

describe("getRestaurantExportYears", () => {
	it("returns the inclusive year range from createdAt to current year", async () => {
		const t = convexTest(schema, modules);
		const fourYearsAgo = Date.UTC(new Date().getUTCFullYear() - 3, 5, 15);
		const { restaurantId } = await seedRestaurant(t, {
			ownerId: "owner1",
			createdAt: fourYearsAgo,
			timezone: "UTC",
		});

		const result = await t
			.withIdentity({ subject: "owner1" })
			.query(api.exports.getRestaurantExportYears, { restaurantId });

		const thisYear = new Date().getUTCFullYear();
		expect(result.years).toEqual([thisYear, thisYear - 1, thisYear - 2, thisYear - 3]);
		expect(result.currentYear).toBe(thisYear);
	});

	it("rejects an unauthenticated request", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedRestaurant(t, { ownerId: "owner1" });
		await expect(t.query(api.exports.getRestaurantExportYears, { restaurantId })).rejects.toThrow(
			/Unauthorized/i
		);
	});

	it("rejects a non-owner non-admin user", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedRestaurant(t, { ownerId: "owner1" });
		await expect(
			t
				.withIdentity({ subject: "stranger" })
				.query(api.exports.getRestaurantExportYears, { restaurantId })
		).rejects.toThrow(/Unauthorized/i);
	});
});

describe("exportOrdersXlsx", () => {
	it("returns a base64 workbook with Summary + 12 monthly sheets, bucketed correctly", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedRestaurant(t, {
			ownerId: "owner1",
			timezone: "UTC",
		});

		// Seed two paid orders in different months.
		await t.run(async (ctx) => {
			const tableId = await ctx.db.insert("tables", {
				restaurantId,
				tableNumber: 5,
				isActive: true,
				createdAt: Date.now(),
			});
			const sessionId = await ctx.db.insert("sessions", {
				restaurantId,
				tableId,
				status: "active",
				startedAt: Date.now(),
			});
			await ctx.db.insert("orders", {
				sessionId,
				restaurantId,
				tableId,
				status: "served",
				totalAmount: 2500,
				paymentState: "paid",
				submittedAt: Date.UTC(2026, 0, 15, 10, 0),
				paidAt: Date.UTC(2026, 0, 15, 10, 5),
				dailyOrderNumber: 1,
				orderServiceDateKey: "2026-01-15",
				createdAt: Date.UTC(2026, 0, 15, 10, 0),
				updatedAt: Date.UTC(2026, 0, 15, 10, 5),
			});
			await ctx.db.insert("orders", {
				sessionId,
				restaurantId,
				tableId,
				status: "served",
				totalAmount: 5000,
				paymentState: "paid",
				submittedAt: Date.UTC(2026, 5, 20, 19, 0),
				paidAt: Date.UTC(2026, 5, 20, 19, 30),
				dailyOrderNumber: 2,
				orderServiceDateKey: "2026-06-20",
				createdAt: Date.UTC(2026, 5, 20, 19, 0),
				updatedAt: Date.UTC(2026, 5, 20, 19, 30),
			});
			// Draft order — should be excluded.
			await ctx.db.insert("orders", {
				sessionId,
				restaurantId,
				tableId,
				status: "draft",
				totalAmount: 0,
				paymentState: "unpaid",
				createdAt: Date.UTC(2026, 5, 21, 12, 0),
				updatedAt: Date.UTC(2026, 5, 21, 12, 0),
			});
		});

		const result = await t
			.withIdentity({ subject: "owner1" })
			.action(api.exports.exportOrdersXlsx, { restaurantId, year: 2026, locale: "en" });

		expect(result.filename).toMatch(/orders.*2026\.xlsx$/);
		expect(result.mimeType).toBe(
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
		);

		const wb = XLSX.read(Buffer.from(result.base64, "base64"), { type: "buffer" });
		expect(wb.SheetNames).toHaveLength(13); // Summary + 12 months
		expect(wb.SheetNames[0]).toBe("Summary");

		// Use the actual generated month-name (locale-dependent) by indexing
		// from SheetNames so we don't drift if Intl backends format differently.
		const januarySheet = wb.Sheets[wb.SheetNames[1]];
		const janRows = XLSX.utils.sheet_to_json<string[]>(januarySheet, { header: 1 });
		// header + one row in January
		expect(janRows).toHaveLength(2);

		const juneSheet = wb.Sheets[wb.SheetNames[6]];
		const juneRows = XLSX.utils.sheet_to_json<string[]>(juneSheet, { header: 1 });
		expect(juneRows).toHaveLength(2);

		// February → empty (just header).
		const februarySheet = wb.Sheets[wb.SheetNames[2]];
		const febRows = XLSX.utils.sheet_to_json<string[]>(februarySheet, { header: 1 });
		expect(febRows).toHaveLength(1);

		// Summary has the per-month counts + 12 month rows + a "total" row +
		// blank + note row. Just check the year total appears.
		const summarySheet = wb.Sheets["Summary"];
		const summaryRows = XLSX.utils.sheet_to_json<string[]>(summarySheet, { header: 1 });
		const totalRow = summaryRows.find(
			(r) => typeof r[0] === "string" && r[0].includes("2026 total")
		);
		expect(totalRow).toBeDefined();
		expect(totalRow?.[1]).toBe(2); // 2 paid orders
		expect(totalRow?.[2]).toBe("75.00"); // 2500c + 5000c = $75.00
	});

	it("rejects a non-authorized user", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedRestaurant(t, { ownerId: "owner1" });
		await expect(
			t
				.withIdentity({ subject: "stranger" })
				.action(api.exports.exportOrdersXlsx, { restaurantId, year: 2026 })
		).rejects.toThrow(/Unauthorized/i);
	});
});

describe("exportPaymentsXlsx (ADR 008 breakdown)", () => {
	/**
	 * Seeds one of each money vintage in June 2026:
	 * - a post-pivot card order (10,000 food + 1,200 customer-borne fee),
	 * - a post-visit tip payment (2,000, no order, no fee),
	 * - a legacy tab payment with no recorded split (5,500, tip folded in),
	 * - a cash order marked paid in person (3,000, no payments row at all).
	 */
	async function seedPaymentVintages(
		t: ReturnType<typeof convexTest>,
		restaurantId: Id<"restaurants">
	) {
		const at = Date.UTC(2026, 5, 20, 19, 0);
		await t.run(async (ctx) => {
			const tableId = await ctx.db.insert("tables", {
				restaurantId,
				tableNumber: 7,
				isActive: true,
				createdAt: at,
			});
			const sessionId = await ctx.db.insert("sessions", {
				restaurantId,
				tableId,
				status: "active",
				startedAt: at,
			});
			const base = { sessionId, restaurantId, tableId, createdAt: at, updatedAt: at };

			const cardOrderId = await ctx.db.insert("orders", {
				...base,
				status: "served",
				totalAmount: 10000,
				paymentState: "paid",
				submittedAt: at,
				paidAt: at,
				settledBy: "stripe",
				dailyOrderNumber: 1,
				orderServiceDateKey: "2026-06-20",
			});
			await ctx.db.insert("payments", {
				restaurantId,
				orderId: cardOrderId,
				amount: 11200,
				subtotalAmount: 10000,
				feeAmount: 1200,
				kind: "order",
				currency: "USD",
				status: "succeeded",
				refundStatus: "none",
				attemptNumber: 1,
				succeededAt: at,
				createdAt: at,
				updatedAt: at,
			});
			await ctx.db.insert("payments", {
				restaurantId,
				sessionId,
				amount: 2000,
				subtotalAmount: 0,
				feeAmount: 0,
				gratuityAmount: 2000,
				kind: "tip",
				currency: "USD",
				status: "succeeded",
				refundStatus: "none",
				attemptNumber: 1,
				succeededAt: at,
				createdAt: at,
				updatedAt: at,
			});
			await ctx.db.insert("payments", {
				restaurantId,
				amount: 5500,
				gratuityAmount: 500,
				currency: "USD",
				status: "succeeded",
				refundStatus: "none",
				attemptNumber: 1,
				succeededAt: at,
				createdAt: at,
				updatedAt: at,
			});
			// Cash order: paid, released to the kitchen, deliberately no payments row.
			await ctx.db.insert("orders", {
				...base,
				status: "served",
				totalAmount: 3000,
				paymentState: "paid",
				submittedAt: at,
				paidAt: at,
				settledBy: "staff",
			});
		});
	}

	it("splits each payment into subtotal, service fee, tip and net to restaurant", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedRestaurant(t, { ownerId: "owner1", timezone: "UTC" });
		await seedPaymentVintages(t, restaurantId);

		const result = await t
			.withIdentity({ subject: "owner1" })
			.action(api.exports.exportPaymentsXlsx, { restaurantId, year: 2026, locale: "en" });

		const wb = XLSX.read(Buffer.from(result.base64, "base64"), { type: "buffer" });
		const juneRows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[6]], { header: 1 });

		const headers = juneRows[0];
		expect(headers).toContain("charged to diner (USD)");
		expect(headers).toContain("subtotal (USD)");
		expect(headers).toContain("tavli service fee (USD)");
		expect(headers).toContain("net to restaurant (USD)");
		expect(headers).toContain("kind");
		// The old ambiguous header is gone: post-pivot it included Tavli's cut.
		expect(headers).not.toContain("amount (USD)");

		const col = (name: string) => headers.indexOf(name);
		const rowsByKind = new Map(juneRows.slice(1).map((r) => [r[col("kind")], r]));

		const orderRow = rowsByKind.get("order")!;
		expect(orderRow[col("charged to diner (USD)")]).toBe("112.00");
		expect(orderRow[col("subtotal (USD)")]).toBe("100.00");
		expect(orderRow[col("tavli service fee (USD)")]).toBe("12.00");
		// No tip on a pay-at-submit charge — tips are their own rows.
		expect(orderRow[col("gratuity (USD)")]).toBe("");
		expect(orderRow[col("net to restaurant (USD)")]).toBe("100.00");

		const tipRow = rowsByKind.get("tip")!;
		expect(tipRow[col("subtotal (USD)")]).toBe("0.00");
		expect(tipRow[col("gratuity (USD)")]).toBe("20.00");
		expect(tipRow[col("net to restaurant (USD)")]).toBe("20.00");

		// Legacy row: charged and gratuity are known, the split never was.
		const legacyRow = rowsByKind.get("")!;
		expect(legacyRow[col("charged to diner (USD)")]).toBe("55.00");
		expect(legacyRow[col("gratuity (USD)")]).toBe("5.00");
		expect(legacyRow[col("subtotal (USD)")]).toBe("");
		expect(legacyRow[col("tavli service fee (USD)")]).toBe("");
		expect(legacyRow[col("net to restaurant (USD)")]).toBe("");
	});

	it("totals the split and reports cash orders, which have no payment row", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedRestaurant(t, { ownerId: "owner1", timezone: "UTC" });
		await seedPaymentVintages(t, restaurantId);

		const result = await t
			.withIdentity({ subject: "owner1" })
			.action(api.exports.exportPaymentsXlsx, { restaurantId, year: 2026, locale: "en" });

		const wb = XLSX.read(Buffer.from(result.base64, "base64"), { type: "buffer" });
		const summaryRows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Summary"], { header: 1 });
		const headers = summaryRows[0];
		const col = (name: string) => headers.indexOf(name);
		const totalRow = summaryRows.find(
			(r) => typeof r[0] === "string" && r[0].includes("2026 total")
		)!;

		expect(totalRow[1]).toBe(3); // three payment rows
		expect(totalRow[col("succeeded charged to diner (USD)")]).toBe("187.00");
		// Post-pivot rows only — the legacy row never recorded a split.
		expect(totalRow[col("succeeded subtotal (USD)")]).toBe("100.00");
		expect(totalRow[col("succeeded tavli service fee (USD)")]).toBe("12.00");
		expect(totalRow[col("succeeded gratuity (USD)")]).toBe("25.00");
		expect(totalRow[col("succeeded net to restaurant (USD)")]).toBe("120.00");
		// The cash order is invisible to the payments table by design.
		expect(totalRow[col("cash orders subtotal (USD)")]).toBe("30.00");
	});
});

describe("exportOrdersXlsx cash orders", () => {
	it("includes an order marked paid in person, which has no assigned business date", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedRestaurant(t, { ownerId: "owner1", timezone: "UTC" });
		const at = Date.UTC(2026, 5, 20, 19, 0);
		await t.run(async (ctx) => {
			const tableId = await ctx.db.insert("tables", {
				restaurantId,
				tableNumber: 9,
				isActive: true,
				createdAt: at,
			});
			const sessionId = await ctx.db.insert("sessions", {
				restaurantId,
				tableId,
				status: "active",
				startedAt: at,
			});
			await ctx.db.insert("orders", {
				sessionId,
				restaurantId,
				tableId,
				status: "served",
				totalAmount: 3000,
				paymentState: "paid",
				submittedAt: at,
				paidAt: at,
				settledBy: "staff",
				createdAt: at,
				updatedAt: at,
			});
		});

		const result = await t
			.withIdentity({ subject: "owner1" })
			.action(api.exports.exportOrdersXlsx, { restaurantId, year: 2026, locale: "en" });

		const wb = XLSX.read(Buffer.from(result.base64, "base64"), { type: "buffer" });
		const juneRows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[6]], { header: 1 });
		expect(juneRows).toHaveLength(2);
		const headers = juneRows[0];
		expect(headers).toContain("settled by");
		expect(juneRows[1][headers.indexOf("settled by")]).toBe("staff");
		// Business date derived from `paidAt`: `markOrderPaidInPerson` never
		// assigns an `orderServiceDateKey`.
		expect(juneRows[1][headers.indexOf("order service date")]).toBe("2026-06-20");

		const summaryRows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Summary"], { header: 1 });
		const totalRow = summaryRows.find(
			(r) => typeof r[0] === "string" && r[0].includes("2026 total")
		);
		expect(totalRow?.[1]).toBe(1);
		expect(totalRow?.[2]).toBe("30.00");
	});
});

describe("exportMenuXlsx", () => {
	it("returns a base64 workbook with 5 menu snapshot sheets", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedRestaurant(t, { ownerId: "owner1" });

		await t.run(async (ctx) => {
			const allMenus = await ctx.db.query("menus").collect();
			const menu = allMenus.find((m) => m.restaurantId === restaurantId);
			if (!menu) throw new Error("seed: menu not found");
			const categoryId = await ctx.db.insert("menuCategories", {
				menuId: menu._id,
				restaurantId,
				name: "Starters",
				displayOrder: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
			await ctx.db.insert("menuItems", {
				categoryId,
				restaurantId,
				name: "Bruschetta",
				basePrice: 800,
				isAvailable: true,
				displayOrder: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
			const groupId = await ctx.db.insert("optionGroups", {
				restaurantId,
				name: "Spice",
				selectionType: "single",
				isRequired: false,
				minSelections: 0,
				maxSelections: 1,
				displayOrder: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
			await ctx.db.insert("options", {
				optionGroupId: groupId,
				restaurantId,
				name: "Mild",
				priceModifier: 0,
				isAvailable: true,
				displayOrder: 0,
				createdAt: Date.now(),
			});
		});

		const result = await t
			.withIdentity({ subject: "owner1" })
			.action(api.exports.exportMenuXlsx, { restaurantId });

		expect(result.filename).toMatch(/menu.*\.xlsx$/);
		const wb = XLSX.read(Buffer.from(result.base64, "base64"), { type: "buffer" });
		expect(wb.SheetNames).toEqual(["Menus", "Categories", "Items", "OptionGroups", "Options"]);
	});
});
