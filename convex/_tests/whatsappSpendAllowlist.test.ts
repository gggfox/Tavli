/**
 * The WhatsApp spend allowlist's admin surface (TAVLI-91).
 *
 * Adding a row here waives a control that protects Tavli's own bill, so the gate
 * is platform admin — the same gate as `featureFlags.ts` — and deliberately not
 * a restaurant owner, who has every incentive to exempt their own regulars and
 * none of the cost. Every change is audit-logged, because "who let this number
 * through, and when" is the only question worth asking after a surprise
 * invoice.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import { ERROR_NAMES } from "../_shared/errors";
import { USER_ROLES } from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const ADMIN = "admin-user";
const OPERATOR_PHONE = "+528114906208";

async function seedRoles(
	t: ReturnType<typeof convexTest>,
	userId: string,
	roles: Array<"admin" | "owner" | "manager" | "customer" | "employee">
) {
	await t.run((ctx) =>
		ctx.db.insert("userRoles", {
			userId,
			roles,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		})
	);
}

const asAdmin = (t: ReturnType<typeof convexTest>) => t.withIdentity({ subject: ADMIN });

const rows = (t: ReturnType<typeof convexTest>) =>
	t.run((ctx) => ctx.db.query("whatsappSpendAllowlist").collect());

const auditEvents = (t: ReturnType<typeof convexTest>) =>
	t.run((ctx) => ctx.db.query("allEvents").collect());

describe("whatsappSpendAllowlist.add", () => {
	it("stores the phone canonically so it matches what WhatsApp delivers", async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t, ADMIN, [USER_ROLES.ADMIN]);

		// WhatsApp reports this number as +5218114906208. Stored raw, the entry
		// would never match the phone it was meant to exempt.
		const [id, error] = await asAdmin(t).mutation(api.whatsappSpendAllowlist.add, {
			phone: "+52 1 811 490 6208",
			label: "Operator",
		});

		expect(error).toBeNull();
		expect(id).not.toBeNull();
		expect(await rows(t)).toMatchObject([{ phone: OPERATOR_PHONE, label: "Operator" }]);
	});

	it("audit-logs the addition as an org-level event", async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t, ADMIN, [USER_ROLES.ADMIN]);

		await asAdmin(t).mutation(api.whatsappSpendAllowlist.add, {
			phone: OPERATOR_PHONE,
			label: "Operator",
		});

		const events = await auditEvents(t);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			eventType: "whatsappSpendAllowlist.added",
			aggregateType: "whatsappSpendAllowlist",
			userId: ADMIN,
		});
		// The allowlist belongs to no restaurant — it exempts a phone from a
		// platform-wide control.
		expect(events[0].restaurantId).toBeUndefined();
	});

	it("rejects a second row for the same human", async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t, ADMIN, [USER_ROLES.ADMIN]);
		await asAdmin(t).mutation(api.whatsappSpendAllowlist.add, {
			phone: OPERATOR_PHONE,
			label: "Operator",
		});

		const [id, error] = await asAdmin(t).mutation(api.whatsappSpendAllowlist.add, {
			phone: "+5218114906208",
			label: "Operator again",
		});

		expect(id).toBeNull();
		expect(error?.message).toBe("ERROR_PHONE_ALREADY_ALLOWLISTED");
		expect(await rows(t)).toHaveLength(1);
	});

	it("requires a label so no unexplained number sits on the list", async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t, ADMIN, [USER_ROLES.ADMIN]);

		const [id, error] = await asAdmin(t).mutation(api.whatsappSpendAllowlist.add, {
			phone: OPERATOR_PHONE,
			label: "   ",
		});

		expect(id).toBeNull();
		expect(error?.name).toBe(ERROR_NAMES.VALIDATION_ERROR);
	});

	it("rejects a phone it cannot place in E.164", async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t, ADMIN, [USER_ROLES.ADMIN]);

		// `normalizeContactPhone` returns unplaceable input untouched. Storing it
		// would create a row that silently exempts nobody.
		const [id, error] = await asAdmin(t).mutation(api.whatsappSpendAllowlist.add, {
			phone: "call the front desk",
			label: "Front desk",
		});

		expect(id).toBeNull();
		expect(error?.name).toBe(ERROR_NAMES.VALIDATION_ERROR);
	});

	it("refuses a restaurant owner", async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t, "owner-user", [USER_ROLES.OWNER]);

		const [id, error] = await t
			.withIdentity({ subject: "owner-user" })
			.mutation(api.whatsappSpendAllowlist.add, { phone: OPERATOR_PHONE, label: "Mine" });

		// An owner exempting their own regulars spends Tavli's money, not theirs.
		expect(id).toBeNull();
		expect(error?.name).toBe(ERROR_NAMES.NOT_AUTHORIZED);
		expect(await rows(t)).toHaveLength(0);
	});

	it("refuses an anonymous caller", async () => {
		const t = convexTest(schema, modules);

		const [id, error] = await t.mutation(api.whatsappSpendAllowlist.add, {
			phone: OPERATOR_PHONE,
			label: "Anon",
		});

		expect(id).toBeNull();
		expect(error?.name).toBe(ERROR_NAMES.NOT_AUTHENTICATED);
	});
});

describe("whatsappSpendAllowlist.remove", () => {
	it("removes the row and audit-logs it", async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t, ADMIN, [USER_ROLES.ADMIN]);
		const [id] = await asAdmin(t).mutation(api.whatsappSpendAllowlist.add, {
			phone: OPERATOR_PHONE,
			label: "Operator",
		});

		const [, error] = await asAdmin(t).mutation(api.whatsappSpendAllowlist.remove, {
			allowlistId: id!,
		});

		expect(error).toBeNull();
		expect(await rows(t)).toHaveLength(0);
		expect((await auditEvents(t)).map((e) => e.eventType)).toEqual([
			"whatsappSpendAllowlist.added",
			"whatsappSpendAllowlist.removed",
		]);
	});

	it("refuses a non-admin", async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t, ADMIN, [USER_ROLES.ADMIN]);
		await seedRoles(t, "manager-user", [USER_ROLES.MANAGER]);
		const [id] = await asAdmin(t).mutation(api.whatsappSpendAllowlist.add, {
			phone: OPERATOR_PHONE,
			label: "Operator",
		});

		const [, error] = await t
			.withIdentity({ subject: "manager-user" })
			.mutation(api.whatsappSpendAllowlist.remove, { allowlistId: id! });

		expect(error?.name).toBe(ERROR_NAMES.NOT_AUTHORIZED);
		expect(await rows(t)).toHaveLength(1);
	});

	it("reports a row that is already gone", async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t, ADMIN, [USER_ROLES.ADMIN]);
		const [id] = await asAdmin(t).mutation(api.whatsappSpendAllowlist.add, {
			phone: OPERATOR_PHONE,
			label: "Operator",
		});
		await asAdmin(t).mutation(api.whatsappSpendAllowlist.remove, { allowlistId: id! });

		const [, error] = await asAdmin(t).mutation(api.whatsappSpendAllowlist.remove, {
			allowlistId: id!,
		});

		expect(error?.name).toBe(ERROR_NAMES.NOT_FOUND);
	});
});

describe("whatsappSpendAllowlist.list", () => {
	it("returns the list to an admin, newest first", async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t, ADMIN, [USER_ROLES.ADMIN]);
		await asAdmin(t).mutation(api.whatsappSpendAllowlist.add, {
			phone: OPERATOR_PHONE,
			label: "Operator",
		});
		await asAdmin(t).mutation(api.whatsappSpendAllowlist.add, {
			phone: "+14155238886",
			label: "QA handset",
		});

		const [listed, error] = await asAdmin(t).query(api.whatsappSpendAllowlist.list, {});

		expect(error).toBeNull();
		expect(listed!.map((r) => r.label)).toEqual(["QA handset", "Operator"]);
	});

	it("refuses a non-admin — the list is a map of who bypasses the caps", async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t, "employee-user", [USER_ROLES.EMPLOYEE]);

		const [listed, error] = await t
			.withIdentity({ subject: "employee-user" })
			.query(api.whatsappSpendAllowlist.list, {});

		expect(listed).toBeNull();
		expect(error?.name).toBe(ERROR_NAMES.NOT_AUTHORIZED);
	});
});

describe("whatsappSpendAllowlist.seedOperatorNumber", () => {
	it("seeds the operator's own number with a label", async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t, ADMIN, [USER_ROLES.ADMIN]);

		const result = await asAdmin(t).mutation(api.whatsappSpendAllowlist.seedOperatorNumber, {});

		expect(result).toMatchObject({ ok: true, created: 1 });
		expect(await rows(t)).toMatchObject([{ phone: OPERATOR_PHONE }]);
		expect((await rows(t))[0].label.length).toBeGreaterThan(0);
	});

	it("is idempotent", async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t, ADMIN, [USER_ROLES.ADMIN]);
		await asAdmin(t).mutation(api.whatsappSpendAllowlist.seedOperatorNumber, {});

		const result = await asAdmin(t).mutation(api.whatsappSpendAllowlist.seedOperatorNumber, {});

		expect(result).toMatchObject({ ok: true, created: 0 });
		expect(await rows(t)).toHaveLength(1);
	});

	it("refuses a non-admin", async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t, "owner-user", [USER_ROLES.OWNER]);

		const result = await t
			.withIdentity({ subject: "owner-user" })
			.mutation(api.whatsappSpendAllowlist.seedOperatorNumber, {});

		expect(result.ok).toBe(false);
		expect(await rows(t)).toHaveLength(0);
	});
});
