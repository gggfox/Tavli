/**
 * Export actions.
 *
 * Each transactional export action (orders / payments / reservations) accepts
 * a calendar year, fetches denormalized rows from the corresponding internal
 * query, buckets them into 12 monthly sheets in the restaurant's timezone,
 * and returns a base64-encoded xlsx workbook. The client decodes the base64
 * and triggers the file download.
 *
 * The menu export is a current-state snapshot (no year picker, no monthly
 * tabs): five sheets describing menus, categories, items, option groups, and
 * options.
 *
 * Authorization is enforced inside the internal queries (owner / manager /
 * admin); the action's `actingUserId` is read from Convex auth.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, query } from "./_generated/server";
import {
	approxBase64Bytes,
	buildMonthlyWorkbook,
	buildSectionedWorkbook,
	type CellValue,
	exportTooLargeMessage,
	formatLocalTimestamp,
	formatMoneyCents,
	getMonthNames,
	monthIndexFromYmd,
	monthIndexInTz,
	type SectionSheet,
	yearInTz,
} from "./exportHelpers";
import { requireRestaurantManagerOrAbove } from "./_util/auth";
import { TABLE } from "./constants";

function csvEscape(cell: string): string {
	if (/[",\n]/.test(cell)) return `"${cell.replaceAll('"', '""')}"`;
	return cell;
}

function toCsv(headers: string[], rows: string[][]): string {
	const lines = [headers.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))];
	return `${lines.join("\n")}\n`;
}

export const exportAttendanceCsv = action({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		fromMs: v.number(),
		toMs: v.number(),
	},
	handler: async (ctx, args): Promise<string> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthorized");

		const events = await ctx.runQuery(internal.attendance.internalListClockEventsForExport, {
			actingUserId: identity.subject,
			restaurantId: args.restaurantId,
			fromMs: args.fromMs,
			toMs: args.toMs,
		});

		const rows = events.map((e: { _id: string; memberId: string; type: string; at: number }) => [
			e._id,
			e.memberId,
			e.type,
			String(e.at),
		]);
		return toCsv(["id", "memberId", "type", "atMs"], rows);
	},
});

export const exportShiftsCsv = action({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		fromMs: v.number(),
		toMs: v.number(),
	},
	handler: async (ctx, args): Promise<string> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthorized");

		const shifts = await ctx.runQuery(internal.shifts.internalListShiftsForExport, {
			actingUserId: identity.subject,
			restaurantId: args.restaurantId,
			fromMs: args.fromMs,
			toMs: args.toMs,
		});

		const rows = shifts.map(
			(s: { _id: string; memberId: string; startsAt: number; endsAt: number; status: string }) => [
				s._id,
				s.memberId,
				String(s.startsAt),
				String(s.endsAt),
				s.status,
			]
		);
		return toCsv(["id", "memberId", "startsAt", "endsAt", "status"], rows);
	},
});

export const exportTipsCsv = action({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		fromBusinessDate: v.optional(v.string()),
		toBusinessDate: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<string> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthorized");

		const entries = await ctx.runQuery(internal.tips.internalListTipEntriesForExport, {
			actingUserId: identity.subject,
			restaurantId: args.restaurantId,
			fromBusinessDate: args.fromBusinessDate,
			toBusinessDate: args.toBusinessDate,
		});

		const rows = entries.map(
			(e: {
				_id: string;
				businessDate: string;
				source: string;
				amountCents: number;
				memberId?: string;
				notes?: string;
			}) => [
				e._id,
				e.businessDate,
				e.source,
				String(e.amountCents),
				e.memberId ?? "",
				e.notes ?? "",
			]
		);
		return toCsv(["id", "businessDate", "source", "amountCents", "memberId", "notes"], rows);
	},
});

export const exportAbsencesCsv = action({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		fromDate: v.optional(v.string()),
		toDate: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<string> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthorized");

		const rowsDoc = await ctx.runQuery(internal.attendance.internalListAbsencesForExport, {
			actingUserId: identity.subject,
			restaurantId: args.restaurantId,
			fromDate: args.fromDate,
			toDate: args.toDate,
		});

		const rows = rowsDoc.map(
			(r: {
				_id: string;
				memberId: string;
				date: string;
				type: string;
				status: string;
				reason?: string;
			}) => [r._id, r.memberId, r.date, r.type, r.status, r.reason ?? ""]
		);
		return toCsv(["id", "memberId", "date", "type", "status", "reason"], rows);
	},
});

// ============================================================================
// Excel exports (xlsx)
// ============================================================================

/**
 * Returns the inclusive list of calendar years that the user can pick from
 * for transactional exports: from the restaurant's creation year through the
 * current year, both interpreted in the restaurant's timezone. The query also
 * enforces owner/manager/admin access (so the year dropdown only appears for
 * the right roles).
 */
export const getRestaurantExportYears = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args): Promise<{ years: number[]; currentYear: number }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthorized");

		const [restaurant, aerr] = await requireRestaurantManagerOrAbove(
			ctx,
			identity.subject,
			args.restaurantId
		);
		if (aerr) throw new Error("Unauthorized");

		const tz = restaurant.timezone ?? "UTC";
		const startYear = yearInTz(restaurant.createdAt, tz) ?? new Date().getUTCFullYear();
		const currentYear = yearInTz(Date.now(), tz) ?? new Date().getUTCFullYear();
		const lo = Math.min(startYear, currentYear);
		const hi = Math.max(startYear, currentYear);
		const years: number[] = [];
		for (let y = hi; y >= lo; y--) years.push(y);
		return { years, currentYear };
	},
});

interface MonthlySheetBucket<T> {
	monthIndex: number;
	sheetName: string;
	rows: T[];
}

function emptyMonthlyBuckets<T>(year: number, locale: string): MonthlySheetBucket<T>[] {
	const monthNames = getMonthNames(locale);
	const buckets: MonthlySheetBucket<T>[] = [];
	for (let i = 0; i < 12; i++) {
		buckets.push({
			monthIndex: i,
			sheetName: `${monthNames[i]} ${year}`,
			rows: [],
		});
	}
	return buckets;
}

function assertNotTooLarge(base64: string, year?: number): void {
	if (approxBase64Bytes(base64) > 7 * 1024 * 1024) {
		throw new Error(exportTooLargeMessage(year));
	}
}

// ----------------------------- Orders --------------------------------------

interface OrderExportRow {
	id: string;
	orderServiceDateKey: string;
	dailyOrderNumber: number | null;
	tableNumber: number | null;
	status: string;
	paymentState: string;
	submittedAt: number | null;
	paidAt: number | null;
	serverDisplay: string;
	itemsSummary: string;
	totalAmountCents: number;
	specialInstructions: string;
}

export const exportOrdersXlsx = action({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		year: v.number(),
		locale: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<{ base64: string; filename: string; mimeType: string }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthorized");

		const restaurant = await ctx.runQuery(internal.restaurants.getRestaurantForExport, {
			actingUserId: identity.subject,
			restaurantId: args.restaurantId,
		});

		const tz = restaurant.timezone ?? "UTC";
		const locale = args.locale ?? "en";
		const currencyLabel = restaurant.currency || "";

		const rows: OrderExportRow[] = await ctx.runQuery(
			internal.orders.internalListOrdersForExportYear,
			{
				actingUserId: identity.subject,
				restaurantId: args.restaurantId,
				year: args.year,
			}
		);

		const buckets = emptyMonthlyBuckets<OrderExportRow>(args.year, locale);
		const monthlyCounts = new Array(12).fill(0);
		const monthlyTotalsCents = new Array(12).fill(0);

		for (const row of rows) {
			const idx = monthIndexFromYmd(row.orderServiceDateKey, args.year);
			if (idx == null) continue;
			buckets[idx].rows.push(row);
			monthlyCounts[idx]++;
			monthlyTotalsCents[idx] += row.totalAmountCents;
		}

		const totalLabel = currencyLabel ? `total amount (${currencyLabel})` : "total amount";

		const headers = [
			"order service date",
			"daily order number",
			"table number",
			"status",
			"payment state",
			"submitted at",
			"paid at",
			"server",
			"items",
			totalLabel,
			"special instructions",
			"order id",
		];

		const mapRow = (r: OrderExportRow): CellValue[] => [
			r.orderServiceDateKey,
			r.dailyOrderNumber,
			r.tableNumber,
			r.status,
			r.paymentState,
			formatLocalTimestamp(r.submittedAt, tz),
			formatLocalTimestamp(r.paidAt, tz),
			r.serverDisplay,
			r.itemsSummary,
			formatMoneyCents(r.totalAmountCents),
			r.specialInstructions,
			r.id,
		];

		const monthNames = getMonthNames(locale);
		const summaryHeaders = ["month", "order count", totalLabel];
		const summaryRows: CellValue[][] = monthNames.map((name, i) => [
			`${name} ${args.year}`,
			monthlyCounts[i],
			formatMoneyCents(monthlyTotalsCents[i]),
		]);
		const grandTotalCents = monthlyTotalsCents.reduce((a, b) => a + b, 0);
		summaryRows.push(
			[`${args.year} total`, rows.length, formatMoneyCents(grandTotalCents)],
			[],
			["Note: only orders with an assigned business date (paid orders) are included."]
		);

		const base64 = buildMonthlyWorkbook<OrderExportRow>({
			monthlySheets: buckets,
			headers,
			mapRow,
			summary: { name: "Summary", headers: summaryHeaders, rows: summaryRows },
		});
		assertNotTooLarge(base64, args.year);

		return {
			base64,
			filename: `tavli-orders-${restaurant.slug || args.restaurantId}-${args.year}.xlsx`,
			mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		};
	},
});

// ----------------------------- Payments ------------------------------------

interface PaymentExportRow {
	id: string;
	orderId: string;
	dailyOrderNumber: number | null;
	tableNumber: number | null;
	status: string;
	refundStatus: string;
	attemptNumber: number;
	amountCents: number;
	gratuityCents: number | null;
	currency: string;
	succeededAt: number | null;
	failedAt: number | null;
	refundRequestedAt: number | null;
	refundedAt: number | null;
	createdAt: number;
	stripePaymentIntentId: string;
	stripeChargeId: string;
	stripeRefundId: string;
	failureCode: string;
	failureMessage: string;
}

export const exportPaymentsXlsx = action({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		year: v.number(),
		locale: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<{ base64: string; filename: string; mimeType: string }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthorized");

		const restaurant = await ctx.runQuery(internal.restaurants.getRestaurantForExport, {
			actingUserId: identity.subject,
			restaurantId: args.restaurantId,
		});

		const tz = restaurant.timezone ?? "UTC";
		const locale = args.locale ?? "en";
		const currencyLabel = restaurant.currency || "";

		// Compute a generous ms window for the year in the restaurant's tz, to
		// reduce row volume fetched by the internal query. The internal query
		// pads by 36h; the final tz-aware bucketing happens here.
		const { yearStartMs, yearEndMs } = approxYearWindowMs(args.year, tz);

		const rows: PaymentExportRow[] = await ctx.runQuery(
			internal.payments.internalListPaymentsForExportYear,
			{
				actingUserId: identity.subject,
				restaurantId: args.restaurantId,
				yearStartMs,
				yearEndMs,
			}
		);

		const buckets = emptyMonthlyBuckets<PaymentExportRow>(args.year, locale);
		const monthlyCounts = new Array(12).fill(0);
		const monthlySucceededCents = new Array(12).fill(0);
		const monthlyGratuityCents = new Array(12).fill(0);

		for (const row of rows) {
			const bucketingMs = row.succeededAt ?? row.createdAt;
			const idx = monthIndexInTz(bucketingMs, args.year, tz);
			if (idx == null) continue;
			buckets[idx].rows.push(row);
			monthlyCounts[idx]++;
			if (row.status === "succeeded") {
				monthlySucceededCents[idx] += row.amountCents;
				monthlyGratuityCents[idx] += row.gratuityCents ?? 0;
			}
		}

		const amountLabel = currencyLabel ? `amount (${currencyLabel})` : "amount";
		const gratuityLabel = currencyLabel ? `gratuity (${currencyLabel})` : "gratuity";

		const headers = [
			"daily order number",
			"table number",
			"status",
			"refund status",
			"attempt",
			amountLabel,
			gratuityLabel,
			"currency",
			"created at",
			"succeeded at",
			"failed at",
			"refund requested at",
			"refunded at",
			"stripe payment intent",
			"stripe charge",
			"stripe refund",
			"failure code",
			"failure message",
			"payment id",
			"order id",
		];

		const mapRow = (r: PaymentExportRow): CellValue[] => [
			r.dailyOrderNumber,
			r.tableNumber,
			r.status,
			r.refundStatus,
			r.attemptNumber,
			formatMoneyCents(r.amountCents),
			formatMoneyCents(r.gratuityCents),
			r.currency,
			formatLocalTimestamp(r.createdAt, tz),
			formatLocalTimestamp(r.succeededAt, tz),
			formatLocalTimestamp(r.failedAt, tz),
			formatLocalTimestamp(r.refundRequestedAt, tz),
			formatLocalTimestamp(r.refundedAt, tz),
			r.stripePaymentIntentId,
			r.stripeChargeId,
			r.stripeRefundId,
			r.failureCode,
			r.failureMessage,
			r.id,
			r.orderId,
		];

		const monthNames = getMonthNames(locale);
		const summaryHeaders = [
			"month",
			"payment rows",
			`succeeded ${amountLabel}`,
			`succeeded ${gratuityLabel}`,
		];
		const summaryRows: CellValue[][] = monthNames.map((name, i) => [
			`${name} ${args.year}`,
			monthlyCounts[i],
			formatMoneyCents(monthlySucceededCents[i]),
			formatMoneyCents(monthlyGratuityCents[i]),
		]);
		const totalCount = rows.length;
		const totalSucceeded = monthlySucceededCents.reduce((a, b) => a + b, 0);
		const totalGratuity = monthlyGratuityCents.reduce((a, b) => a + b, 0);
		summaryRows.push(
			[
				`${args.year} total`,
				totalCount,
				formatMoneyCents(totalSucceeded),
				formatMoneyCents(totalGratuity),
			],
			[],
			["Note: rows are bucketed by succeededAt when available; createdAt is used otherwise."]
		);

		const base64 = buildMonthlyWorkbook<PaymentExportRow>({
			monthlySheets: buckets,
			headers,
			mapRow,
			summary: { name: "Summary", headers: summaryHeaders, rows: summaryRows },
		});
		assertNotTooLarge(base64, args.year);

		return {
			base64,
			filename: `tavli-payments-${restaurant.slug || args.restaurantId}-${args.year}.xlsx`,
			mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		};
	},
});

// ----------------------------- Reservations --------------------------------

interface ReservationExportRow {
	id: string;
	startsAt: number;
	endsAt: number;
	partySize: number;
	status: string;
	source: string;
	guestName: string;
	guestPhone: string;
	guestEmail: string;
	tablesText: string;
	notes: string;
	confirmedAt: number | null;
	seatedAt: number | null;
	completedAt: number | null;
	cancelledAt: number | null;
	cancelReason: string;
	createdAt: number;
}

export const exportReservationsXlsx = action({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		year: v.number(),
		locale: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<{ base64: string; filename: string; mimeType: string }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthorized");

		const restaurant = await ctx.runQuery(internal.restaurants.getRestaurantForExport, {
			actingUserId: identity.subject,
			restaurantId: args.restaurantId,
		});

		const tz = restaurant.timezone ?? "UTC";
		const locale = args.locale ?? "en";

		const { yearStartMs, yearEndMs } = approxYearWindowMs(args.year, tz);
		// Pad an extra day on each side to be safe across tz boundaries.
		const DAY_MS = 24 * 60 * 60 * 1000;
		const rows: ReservationExportRow[] = await ctx.runQuery(
			internal.reservations.internalListReservationsForExportYear,
			{
				actingUserId: identity.subject,
				restaurantId: args.restaurantId,
				fromMs: yearStartMs - DAY_MS,
				toMs: yearEndMs + DAY_MS,
			}
		);

		const buckets = emptyMonthlyBuckets<ReservationExportRow>(args.year, locale);
		const monthlyCounts = new Array(12).fill(0);
		const monthlyGuestCounts = new Array(12).fill(0);

		for (const row of rows) {
			const idx = monthIndexInTz(row.startsAt, args.year, tz);
			if (idx == null) continue;
			buckets[idx].rows.push(row);
			monthlyCounts[idx]++;
			monthlyGuestCounts[idx] += row.partySize;
		}

		const headers = [
			"starts at",
			"ends at",
			"party size",
			"status",
			"source",
			"guest name",
			"phone",
			"email",
			"tables",
			"notes",
			"created at",
			"confirmed at",
			"seated at",
			"completed at",
			"cancelled at",
			"cancel reason",
			"reservation id",
		];

		const mapRow = (r: ReservationExportRow): CellValue[] => [
			formatLocalTimestamp(r.startsAt, tz),
			formatLocalTimestamp(r.endsAt, tz),
			r.partySize,
			r.status,
			r.source,
			r.guestName,
			r.guestPhone,
			r.guestEmail,
			r.tablesText,
			r.notes,
			formatLocalTimestamp(r.createdAt, tz),
			formatLocalTimestamp(r.confirmedAt, tz),
			formatLocalTimestamp(r.seatedAt, tz),
			formatLocalTimestamp(r.completedAt, tz),
			formatLocalTimestamp(r.cancelledAt, tz),
			r.cancelReason,
			r.id,
		];

		const monthNames = getMonthNames(locale);
		const summaryHeaders = ["month", "reservations", "guests"];
		const summaryRows: CellValue[][] = monthNames.map((name, i) => [
			`${name} ${args.year}`,
			monthlyCounts[i],
			monthlyGuestCounts[i],
		]);
		const totalGuests = monthlyGuestCounts.reduce((a, b) => a + b, 0);
		summaryRows.push(
			[`${args.year} total`, rows.length, totalGuests],
			[],
			["Note: rows are bucketed by startsAt (the reservation's service time)."]
		);

		const base64 = buildMonthlyWorkbook<ReservationExportRow>({
			monthlySheets: buckets,
			headers,
			mapRow,
			summary: { name: "Summary", headers: summaryHeaders, rows: summaryRows },
		});
		assertNotTooLarge(base64, args.year);

		return {
			base64,
			filename: `tavli-reservations-${restaurant.slug || args.restaurantId}-${args.year}.xlsx`,
			mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		};
	},
});

// ----------------------------- Menu ----------------------------------------

interface MenuSnapshot {
	menus: {
		id: string;
		name: string;
		description: string;
		isActive: boolean;
		displayOrder: number;
		defaultLanguage: string;
		supportedLanguages: string;
	}[];
	categories: {
		id: string;
		menuId: string;
		menuName: string;
		name: string;
		description: string;
		displayOrder: number;
	}[];
	items: {
		id: string;
		menuId: string;
		menuName: string;
		categoryId: string;
		categoryName: string;
		name: string;
		description: string;
		basePriceCents: number;
		isAvailable: boolean;
		unavailableReason: string;
		displayOrder: number;
		tags: string;
	}[];
	optionGroups: {
		id: string;
		name: string;
		selectionType: string;
		isRequired: boolean;
		minSelections: number;
		maxSelections: number;
		displayOrder: number;
	}[];
	options: {
		id: string;
		optionGroupId: string;
		optionGroupName: string;
		name: string;
		priceModifierCents: number;
		isAvailable: boolean;
		displayOrder: number;
	}[];
}

export const exportMenuXlsx = action({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
	},
	handler: async (ctx, args): Promise<{ base64: string; filename: string; mimeType: string }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthorized");

		const restaurant = await ctx.runQuery(internal.restaurants.getRestaurantForExport, {
			actingUserId: identity.subject,
			restaurantId: args.restaurantId,
		});
		const currencyLabel = restaurant.currency || "";
		const tz = restaurant.timezone ?? "UTC";

		const snapshot: MenuSnapshot = await ctx.runQuery(
			internal.menus.internalListMenuSnapshotForExport,
			{
				actingUserId: identity.subject,
				restaurantId: args.restaurantId,
			}
		);

		const priceLabel = currencyLabel ? `base price (${currencyLabel})` : "base price";
		const modifierLabel = currencyLabel ? `price modifier (${currencyLabel})` : "price modifier";

		const sections: SectionSheet<unknown>[] = [
			{
				name: "Menus",
				headers: [
					"name",
					"description",
					"is active",
					"display order",
					"default language",
					"supported languages",
					"id",
				],
				rows: snapshot.menus,
				mapRow: (raw): CellValue[] => {
					const m = raw as MenuSnapshot["menus"][number];
					return [
						m.name,
						m.description,
						m.isActive ? "yes" : "no",
						m.displayOrder,
						m.defaultLanguage,
						m.supportedLanguages,
						m.id,
					];
				},
			},
			{
				name: "Categories",
				headers: ["menu", "name", "description", "display order", "id", "menu id"],
				rows: snapshot.categories,
				mapRow: (raw): CellValue[] => {
					const c = raw as MenuSnapshot["categories"][number];
					return [c.menuName, c.name, c.description, c.displayOrder, c.id, c.menuId];
				},
			},
			{
				name: "Items",
				headers: [
					"menu",
					"category",
					"name",
					"description",
					priceLabel,
					"is available",
					"unavailable reason",
					"display order",
					"tags",
					"id",
				],
				rows: snapshot.items,
				mapRow: (raw): CellValue[] => {
					const i = raw as MenuSnapshot["items"][number];
					return [
						i.menuName,
						i.categoryName,
						i.name,
						i.description,
						formatMoneyCents(i.basePriceCents),
						i.isAvailable ? "yes" : "no",
						i.unavailableReason,
						i.displayOrder,
						i.tags,
						i.id,
					];
				},
			},
			{
				name: "OptionGroups",
				headers: [
					"name",
					"selection type",
					"is required",
					"min selections",
					"max selections",
					"display order",
					"id",
				],
				rows: snapshot.optionGroups,
				mapRow: (raw): CellValue[] => {
					const g = raw as MenuSnapshot["optionGroups"][number];
					return [
						g.name,
						g.selectionType,
						g.isRequired ? "yes" : "no",
						g.minSelections,
						g.maxSelections,
						g.displayOrder,
						g.id,
					];
				},
			},
			{
				name: "Options",
				headers: [
					"option group",
					"name",
					modifierLabel,
					"is available",
					"display order",
					"id",
					"option group id",
				],
				rows: snapshot.options,
				mapRow: (raw): CellValue[] => {
					const o = raw as MenuSnapshot["options"][number];
					return [
						o.optionGroupName,
						o.name,
						formatMoneyCents(o.priceModifierCents),
						o.isAvailable ? "yes" : "no",
						o.displayOrder,
						o.id,
						o.optionGroupId,
					];
				},
			},
		];

		const base64 = buildSectionedWorkbook(sections);
		assertNotTooLarge(base64);

		const timestampLabel = formatLocalTimestamp(Date.now(), tz)
			.replaceAll(" ", "_")
			.replaceAll(":", "-");

		return {
			base64,
			filename: `tavli-menu-${restaurant.slug || args.restaurantId}-${timestampLabel}.xlsx`,
			mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		};
	},
});

// ----------------------------- shared helpers ------------------------------

/**
 * Compute the approximate ms window for a calendar year in the given timezone.
 * Returns the first day of January at 00:00 (interpreted as UTC, then shifted
 * by the tz's offset) and the last second of December.
 *
 * This is a coarse approximation used only to bound database scans — the
 * final tz-aware month bucketing happens in `monthIndexInTz`.
 */
function approxYearWindowMs(
	year: number,
	// Accepted for future use (precise tz-aware window); internal queries pad
	// by 36h which covers any realistic IANA offset.
	_timeZone: string
): { yearStartMs: number; yearEndMs: number } {
	const yearStartMs = Date.UTC(year, 0, 1, 0, 0, 0, 0);
	const yearEndMs = Date.UTC(year, 11, 31, 23, 59, 59, 999);
	return { yearStartMs, yearEndMs };
}
