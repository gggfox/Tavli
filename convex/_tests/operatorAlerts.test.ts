/**
 * Operator alerts (TAVLI-109).
 *
 * What is pinned here is what an operator would notice being wrong: a replayed
 * webhook does not fill the page with the same problem fifty times, an
 * acknowledged problem that happens again is a new alert rather than silence,
 * a severe alert reaches every platform admin exactly once, and nobody without
 * the admin role can read or clear the list.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
	OPERATOR_ALERT_EXPLANATION_KEY,
	OPERATOR_ALERT_KIND,
	OPERATOR_ALERT_SEVERITY,
	OPERATOR_ALERT_STATUS,
	TABLE,
} from "../constants";
import { raiseOperatorAlert } from "../_util/operatorAlerts";
import { ACKNOWLEDGED_ALERTS_LIMIT } from "../operatorAlerts";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

type T = ReturnType<typeof convexTest>;

const NOW = Date.now();

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
	fetchMock.mockReset();
	fetchMock.mockResolvedValue({ ok: true, text: async () => "" });
	process.env.PUBLIC_APP_URL = "https://app.tavliai.com";
	process.env.RESEND_API_KEY = "re_test";
	process.env.RESEND_FROM_ADDRESS = "Tavli <no-reply@tavliai.com>";
});

async function seedRestaurant(t: T, slug: string): Promise<Id<"restaurants">> {
	return t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: `${slug} org`,
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});
		return ctx.db.insert("restaurants", {
			ownerId: "owner-1",
			organizationId,
			name: slug,
			slug,
			currency: "MXN",
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		});
	});
}

async function seedUserRole(
	t: T,
	args: {
		userId: string;
		roles: ("admin" | "owner" | "manager" | "customer" | "employee")[];
		email?: string;
		firstName?: string;
		paternalLastname?: string;
	}
) {
	await t.run(async (ctx) => {
		await ctx.db.insert(TABLE.USER_ROLES, {
			userId: args.userId,
			email: args.email,
			firstName: args.firstName,
			paternalLastname: args.paternalLastname,
			roles: args.roles,
			createdAt: NOW,
			updatedAt: NOW,
		});
	});
}

async function allAlerts(t: T) {
	return t.run(async (ctx) => ctx.db.query(TABLE.OPERATOR_ALERTS).collect());
}

async function scheduledEmails(t: T) {
	const scheduled = await t.run(
		async (ctx) => await ctx.db.system.query("_scheduled_functions").collect()
	);
	return scheduled.filter((job) => job.name.includes("sendOperatorAlertEmail"));
}

describe("raiseOperatorAlert", () => {
	it("records the alert as open, with the kind's default severity and message key", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, "la-cocina");

		const alertId = await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.PAYMENT_STUCK,
			restaurantId,
			stripeObjectId: "pi_stuck_1",
		});

		const rows = await allAlerts(t);
		expect(rows).toHaveLength(1);
		expect(rows[0]._id).toBe(alertId);
		expect(rows[0]).toMatchObject({
			kind: OPERATOR_ALERT_KIND.PAYMENT_STUCK,
			severity: OPERATOR_ALERT_SEVERITY.WARNING,
			status: OPERATOR_ALERT_STATUS.OPEN,
			restaurantId,
			stripeObjectId: "pi_stuck_1",
			messageKey: OPERATOR_ALERT_EXPLANATION_KEY[OPERATOR_ALERT_KIND.PAYMENT_STUCK],
		});
		expect(rows[0].acknowledgedAt).toBeUndefined();
	});

	it("is callable straight from a mutation context, without a round trip", async () => {
		const t = convexTest(schema, modules);

		const alertId = await t.run(async (ctx) =>
			raiseOperatorAlert(ctx, {
				kind: OPERATOR_ALERT_KIND.DASHBOARD_REFUND,
				messageParams: { amount: 12345 },
			})
		);

		const rows = await allAlerts(t);
		expect(rows).toHaveLength(1);
		expect(rows[0]._id).toBe(alertId);
		expect(rows[0].messageParams).toEqual({ amount: 12345 });
	});

	it("raises once while the dedupe key is open, however often the webhook replays", async () => {
		const t = convexTest(schema, modules);

		const first = await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.DISPUTE_LOST,
			dedupeKey: "dispute:dp_1",
		});
		const second = await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.DISPUTE_LOST,
			dedupeKey: "dispute:dp_1",
		});

		expect(second).toBe(first);
		expect(await allAlerts(t)).toHaveLength(1);
	});

	it("raises a fresh alert when the same problem recurs after an acknowledgement", async () => {
		const t = convexTest(schema, modules);
		await seedUserRole(t, { userId: "admin-1", roles: ["admin"] });
		const admin = t.withIdentity({ subject: "admin-1" });

		const first = await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.DISPUTE_LOST,
			dedupeKey: "dispute:dp_1",
		});
		await admin.mutation(api.operatorAlerts.acknowledge, { alertId: first });

		const second = await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.DISPUTE_LOST,
			dedupeKey: "dispute:dp_1",
		});

		expect(second).not.toBe(first);
		expect(await allAlerts(t)).toHaveLength(2);
	});

	it("keeps alerts without a dedupe key separate", async () => {
		const t = convexTest(schema, modules);

		await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.PAYMENT_STUCK,
		});
		await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.PAYMENT_STUCK,
		});

		expect(await allAlerts(t)).toHaveLength(2);
	});
});

describe("severe alerts reach the platform admins", () => {
	// The scheduled jobs are drained inside each test; without fake timers the
	// drain cannot run them, and an undrained job writes to the scheduler table
	// after its transaction has closed.
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("schedules exactly one email per platform admin, in their own language", async () => {
		const t = convexTest(schema, modules);
		await seedUserRole(t, { userId: "admin-1", roles: ["admin"], email: "ops@tavliai.com" });
		await seedUserRole(t, { userId: "admin-2", roles: ["admin"], email: "sre@tavliai.com" });
		// Reachable by nobody: no email address on the role row.
		await seedUserRole(t, { userId: "admin-3", roles: ["admin"] });
		await t.run(async (ctx) => {
			await ctx.db.insert(TABLE.USER_SETTINGS, { userId: "admin-2", language: "es" });
		});

		await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.PAYOUT_FAILED,
			stripeObjectId: "po_1",
		});

		const jobs = await scheduledEmails(t);
		expect(jobs).toHaveLength(2);
		const byEmail = new Map(
			jobs.map((job) => [
				(job.args[0] as { email: string; locale: string }).email,
				job.args[0] as { email: string; locale: string },
			])
		);
		expect(byEmail.get("ops@tavliai.com")?.locale).toBe("en");
		expect(byEmail.get("sre@tavliai.com")?.locale).toBe("es");

		await t.finishAllScheduledFunctions(() => vi.runAllTimers());
	});

	/**
	 * The org-level `owner` role is the CLIENT proprietor of a restaurant group,
	 * not an operator of Tavli. Mailing them would send one client's incident to
	 * every other client's owner, with a link to a page their role cannot open.
	 */
	it("never emails an org-level owner, or a restaurant manager", async () => {
		const t = convexTest(schema, modules);
		await seedUserRole(t, { userId: "owner-1", roles: ["owner"], email: "founder@lacocina.mx" });
		await seedUserRole(t, {
			userId: "manager-1",
			roles: ["manager"],
			email: "gerente@lacocina.mx",
		});

		await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.PAYOUT_FAILED,
		});

		expect(await scheduledEmails(t)).toHaveLength(0);
	});

	it("emails one person once, however many org role rows they hold", async () => {
		const t = convexTest(schema, modules);
		await seedUserRole(t, { userId: "admin-1", roles: ["admin"], email: "ops@tavliai.com" });
		await seedUserRole(t, { userId: "admin-1", roles: ["admin"], email: "ops@tavliai.com" });

		await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.ACCOUNT_CLOSED,
		});

		expect(await scheduledEmails(t)).toHaveLength(1);
		await t.finishAllScheduledFunctions(() => vi.runAllTimers());
	});

	it("emails nobody for an alert below severe", async () => {
		const t = convexTest(schema, modules);
		await seedUserRole(t, { userId: "admin-1", roles: ["admin"], email: "ops@tavliai.com" });

		await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.PAYMENT_STUCK,
		});

		expect(await scheduledEmails(t)).toHaveLength(0);
	});

	it("emails nobody a second time when a deduped severe alert is re-raised", async () => {
		const t = convexTest(schema, modules);
		await seedUserRole(t, { userId: "admin-1", roles: ["admin"], email: "ops@tavliai.com" });

		await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.CHARGE_UNMATCHED,
			dedupeKey: "charge:ch_1",
		});
		await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.CHARGE_UNMATCHED,
			dedupeKey: "charge:ch_1",
		});

		expect(await scheduledEmails(t)).toHaveLength(1);
		await t.finishAllScheduledFunctions(() => vi.runAllTimers());
	});
});

/**
 * Real timers here: this test seeds no platform admins, so the severe raise
 * schedules nothing, and `render` from react-email is happier unmocked.
 */
describe("the severe-alert email", () => {
	it("sends the rendered alert to Resend, naming the restaurant", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seedRestaurant(t, "la-cocina");

		const alertId = await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.CHARGE_UNMATCHED,
			restaurantId,
			stripeObjectId: "ch_unmatched_1",
		});

		await t.action(internal.operatorAlertActions.sendOperatorAlertEmail, {
			alertId,
			email: "ops@tavliai.com",
			locale: "en",
		});

		const emailCall = fetchMock.mock.calls.find(([url]) => url === "https://api.resend.com/emails");
		expect(emailCall).toBeDefined();
		const body = JSON.parse(emailCall![1].body as string) as {
			to: string[];
			subject: string;
			html: string;
		};
		expect(body.to).toEqual(["ops@tavliai.com"]);
		expect(body.subject).toContain("Charge matches no order");
		expect(body.html).toContain("la-cocina");
		expect(body.html).toContain("ch_unmatched_1");
	});
});

describe("the admin alerts list", () => {
	it("puts open alerts first, newest first inside each group", async () => {
		const t = convexTest(schema, modules);
		await seedUserRole(t, { userId: "admin-1", roles: ["admin"] });
		const admin = t.withIdentity({ subject: "admin-1" });

		const older = await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.PAYMENT_STUCK,
		});
		const acknowledged = await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.DASHBOARD_REFUND,
		});
		const newest = await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.DISPUTE_LOST,
		});
		await admin.mutation(api.operatorAlerts.acknowledge, { alertId: acknowledged });

		const [rows, error] = await admin.query(api.operatorAlerts.list, {});
		expect(error).toBeNull();
		expect(rows!.map((row) => row._id)).toEqual([newest, older, acknowledged]);
	});

	it("names the admin who acknowledged an alert, never their Clerk subject", async () => {
		const t = convexTest(schema, modules);
		await seedUserRole(t, {
			userId: "user_2abcCLERKSUBJECT",
			roles: ["admin"],
			email: "ada@tavliai.com",
			firstName: "Ada",
			paternalLastname: "Lovelace",
		});
		const admin = t.withIdentity({ subject: "user_2abcCLERKSUBJECT" });

		const alertId = await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.PAYMENT_STUCK,
		});
		await admin.mutation(api.operatorAlerts.acknowledge, { alertId });

		const [rows] = await admin.query(api.operatorAlerts.list, {});
		expect(rows![0].acknowledgedBy).toBe("user_2abcCLERKSUBJECT");
		expect(rows![0].acknowledgedByName).toBe("Ada Lovelace");
	});

	it("caps the acknowledged history and keeps the newest of it", async () => {
		const t = convexTest(schema, modules);
		await seedUserRole(t, { userId: "admin-1", roles: ["admin"] });
		const admin = t.withIdentity({ subject: "admin-1" });

		// Inserted directly: this is about the read limit, not about the
		// acknowledge path, and 200+ round trips through the mutation would only
		// make the test slow.
		await t.run(async (ctx) => {
			for (let i = 0; i < ACKNOWLEDGED_ALERTS_LIMIT + 2; i++) {
				await ctx.db.insert(TABLE.OPERATOR_ALERTS, {
					kind: OPERATOR_ALERT_KIND.DASHBOARD_REFUND,
					severity: OPERATOR_ALERT_SEVERITY.WARNING,
					status: OPERATOR_ALERT_STATUS.ACKNOWLEDGED,
					messageKey: OPERATOR_ALERT_EXPLANATION_KEY[OPERATOR_ALERT_KIND.DASHBOARD_REFUND],
					acknowledgedBy: "admin-1",
					acknowledgedAt: NOW + i,
					createdAt: NOW + i,
				});
			}
		});
		// An open alert is never dropped, however much history sits behind it.
		const openId = await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.PAYMENT_STUCK,
		});

		const [rows] = await admin.query(api.operatorAlerts.list, {});
		expect(rows).toHaveLength(ACKNOWLEDGED_ALERTS_LIMIT + 1);
		expect(rows![0]._id).toBe(openId);
		// Newest-first, so the two oldest acknowledged rows are the ones cut.
		const oldestKept = rows!.at(-1)!;
		expect(oldestKept.createdAt).toBe(NOW + 2);
	});

	it("records who acknowledged an alert and when", async () => {
		const t = convexTest(schema, modules);
		await seedUserRole(t, { userId: "admin-1", roles: ["admin"] });
		const admin = t.withIdentity({ subject: "admin-1" });

		const alertId = await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.PAYMENT_STUCK,
		});
		const before = Date.now();
		const [acknowledgedId, error] = await admin.mutation(api.operatorAlerts.acknowledge, {
			alertId,
		});

		expect(error).toBeNull();
		expect(acknowledgedId).toBe(alertId);
		const row = await t.run(async (ctx) => ctx.db.get(alertId));
		expect(row?.status).toBe(OPERATOR_ALERT_STATUS.ACKNOWLEDGED);
		expect(row?.acknowledgedBy).toBe("admin-1");
		expect(row?.acknowledgedAt).toBeGreaterThanOrEqual(before);
	});

	it("treats a second acknowledgement as a no-op, keeping the first actor", async () => {
		const t = convexTest(schema, modules);
		await seedUserRole(t, { userId: "admin-1", roles: ["admin"] });
		await seedUserRole(t, { userId: "admin-2", roles: ["admin"] });

		const alertId = await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.PAYMENT_STUCK,
		});
		await t.withIdentity({ subject: "admin-1" }).mutation(api.operatorAlerts.acknowledge, {
			alertId,
		});
		await t.withIdentity({ subject: "admin-2" }).mutation(api.operatorAlerts.acknowledge, {
			alertId,
		});

		const row = await t.run(async (ctx) => ctx.db.get(alertId));
		expect(row?.acknowledgedBy).toBe("admin-1");
	});

	it("refuses to list or acknowledge for anyone who is not a platform admin", async () => {
		const t = convexTest(schema, modules);
		await seedUserRole(t, { userId: "manager-1", roles: ["manager"] });
		const manager = t.withIdentity({ subject: "manager-1" });

		const alertId = await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.PAYMENT_STUCK,
		});

		const [rows, listError] = await manager.query(api.operatorAlerts.list, {});
		expect(rows).toBeNull();
		expect(listError?.message).toBe("ERROR_ADMIN_ROLE_REQUIRED");

		const [acknowledgedId, ackError] = await manager.mutation(api.operatorAlerts.acknowledge, {
			alertId,
		});
		expect(acknowledgedId).toBeNull();
		expect(ackError?.message).toBe("ERROR_ADMIN_ROLE_REQUIRED");

		const row = await t.run(async (ctx) => ctx.db.get(alertId));
		expect(row?.status).toBe(OPERATOR_ALERT_STATUS.OPEN);
	});

	it("refuses a signed-out caller", async () => {
		const t = convexTest(schema, modules);

		const [rows, listError] = await t.query(api.operatorAlerts.list, {});
		expect(rows).toBeNull();
		expect(listError?.name).toBe("NOT_AUTHENTICATED");
	});
});

describe("restaurant purge", () => {
	it("removes the purged restaurant's alerts and leaves everyone else's", async () => {
		const t = convexTest(schema, modules);
		const doomed = await seedRestaurant(t, "doomed");
		const survivor = await seedRestaurant(t, "survivor");

		await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.PAYMENT_STUCK,
			restaurantId: doomed,
		});
		await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.PAYMENT_STUCK,
			restaurantId: survivor,
		});
		// Platform-wide: belongs to no restaurant, so no purge can take it.
		await t.mutation(internal.operatorAlerts.raiseOperatorAlertInternal, {
			kind: OPERATOR_ALERT_KIND.CHARGE_UNMATCHED,
		});

		await t.run(async (ctx) => {
			await ctx.db.patch(doomed, {
				deletedAt: NOW - 1000,
				deletedBy: "admin-1",
				hardDeleteAfterAt: NOW - 1000,
				isActive: false,
			});
		});
		await t.mutation(internal.restaurantPurge.purgeRestaurantInternal, { restaurantId: doomed });

		const remaining = await allAlerts(t);
		expect(remaining).toHaveLength(2);
		expect(remaining.map((row) => row.restaurantId)).toEqual(
			expect.arrayContaining([survivor, undefined])
		);
	});
});
