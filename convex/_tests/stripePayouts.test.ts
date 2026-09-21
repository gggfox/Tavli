/**
 * Connected-account payout events (TAVLI-103).
 *
 * Stripe pays a connected account's balance out to the restaurant's bank on a
 * schedule. Before this ticket there was no `payout.*` handler anywhere, so a
 * failed payout was invisible to everyone: the money sat in the Stripe balance
 * and the restaurant just stopped being paid. These tests pin the whole chain —
 * the third route's status codes, replay dedup, what one `payout.failed` does to
 * the row / the bell / the inbox / `/admin/alerts`, how out-of-order deliveries
 * are resolved, and the held total's "resolved by a later paid payout" rule.
 *
 * Payout events are **v1 snapshot** events (a full `data.object` plus an
 * `account` property), so they are parsed by `webhooks.constructEvent` — the
 * same call `fulfillPayment` uses — which the shared Stripe mock stubs.
 */
import { convexTest } from "convex-test";
import { registerDisputeComponents } from "./_fixtures/disputeComponents.fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { mockStripeClient } from "./_fixtures/stripeMock.fixture";

const modules = import.meta.glob("../**/*.ts");

vi.mock("stripe", async () => (await import("./_fixtures/stripeMock.fixture")).stripeModuleMock());

const OWNER = "owner-payouts";
const ACCOUNT = "acct_payouts_1";

/**
 * A `convexTest` harness whose scheduled email jobs are drained in `afterEach`.
 *
 * `payout.failed` schedules one `sendPayoutEmail` per recipient with
 * `runAfter(0)`. Left alone those jobs complete after the test body returns,
 * when convex-test's fake database has no open transaction, and every one of
 * them surfaces as an unhandled `Write outside of transaction …
 * _scheduled_functions` rejection — noise that would eventually hide a real one.
 */
let harnesses: ReturnType<typeof convexTest>[] = [];

function harness(): ReturnType<typeof convexTest> {
	const t = convexTest(schema, modules);
	registerDisputeComponents(t);
	harnesses.push(t);
	return t;
}

afterEach(async () => {
	const pending = harnesses;
	harnesses = [];
	for (const t of pending) {
		await t.finishAllScheduledFunctions(() => {
			vi.runAllTimers();
		});
	}
	vi.useRealTimers();
});

/** A v1 snapshot event as delivered on a connected-account destination. */
function payoutEvent(args: {
	eventId: string;
	type: string;
	account?: string;
	payout: Record<string, unknown>;
}) {
	return {
		id: args.eventId,
		object: "event",
		type: args.type,
		account: args.account ?? ACCOUNT,
		api_version: "2024-06-20",
		created: Math.floor(Date.now() / 1000),
		livemode: false,
		pending_webhooks: 1,
		request: { id: null, idempotency_key: null },
		data: { object: args.payout },
	};
}

function payout(args: {
	id: string;
	amount?: number;
	status: string;
	created?: number;
	failureCode?: string;
	failureMessage?: string;
}) {
	return {
		id: args.id,
		object: "payout",
		amount: args.amount ?? 250_00,
		currency: "mxn",
		status: args.status,
		created: args.created ?? 1_700_000_000,
		arrival_date: (args.created ?? 1_700_000_000) + 86_400,
		failure_code: args.failureCode ?? null,
		failure_message: args.failureMessage ?? null,
		failure_balance_transaction: args.failureCode ? "txn_reversal_1" : null,
	};
}

async function deliver(
	t: ReturnType<typeof convexTest>,
	event: ReturnType<typeof payoutEvent>
): Promise<void> {
	mockStripeClient.webhooks.constructEvent.mockReturnValueOnce(event);
	await t.action(internal.stripe.handleConnectedAccountEvent, {
		payloadString: JSON.stringify(event),
		signatureHeader: `sig_${event.id}`,
	});
}

/**
 * A restaurant with a connected account, its owner reachable by email, and a
 * second manager — so "one notification per manager" and "one email per
 * recipient" are counted against more than one person.
 */
async function seedRestaurant(
	t: ReturnType<typeof convexTest>,
	opts: { stripeAccountId?: string } = {}
): Promise<Id<"restaurants">> {
	let restaurantId: Id<"restaurants">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Payouts Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: OWNER,
			organizationId,
			name: "Payouts Restaurant",
			slug: `payouts-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			stripeAccountId: opts.stripeAccountId ?? ACCOUNT,
			stripeOnboardingComplete: true,
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});

		await ctx.db.insert("userRoles", {
			userId: OWNER,
			organizationId,
			roles: ["owner"],
			email: "owner@example.com",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.db.insert("userRoles", {
			userId: "manager-payouts",
			organizationId,
			roles: ["manager"],
			email: "manager@example.com",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await ctx.db.insert("restaurantMembers", {
			restaurantId,
			organizationId,
			userId: "manager-payouts",
			role: "manager",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return restaurantId!;
}

describe("payout events on the connected-account destination (TAVLI-103)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Fake timers so `afterEach` can drain the scheduled email jobs
		// deterministically rather than letting them land after the test.
		vi.useFakeTimers();
		process.env.STRIPE_SECRET_KEY = "sk_test_123";
		process.env.STRIPE_CONNECTED_ACCOUNT_WEBHOOK_SECRET = "whsec_connected_test";
	});

	describe("POST /stripe/connected-webhook status codes", () => {
		it("answers 400 with no stripe-signature header", async () => {
			const t = harness();
			const response = await t.fetch("/stripe/connected-webhook", {
				method: "POST",
				body: "{}",
			});
			expect(response.status).toBe(400);
		});

		it("answers 500 when the signing secret is not configured, not 400", async () => {
			const t = harness();
			// The state every deployment is in until somebody sets it.
			delete process.env.STRIPE_CONNECTED_ACCOUNT_WEBHOOK_SECRET;
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

			const response = await t.fetch("/stripe/connected-webhook", {
				method: "POST",
				headers: { "stripe-signature": "sig_whatever" },
				body: "{}",
			});

			// 400 would read as "Stripe sent something we rejected" and send the
			// operator hunting a wrong secret when there is no secret at all.
			expect(response.status).toBe(500);
			expect(await response.text()).toContain("not configured");
			errorSpy.mockRestore();
		});

		it("answers 400 when the delivery itself fails signature verification", async () => {
			const t = harness();
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			mockStripeClient.webhooks.constructEvent.mockImplementationOnce(() => {
				throw new Error("No signatures found matching the expected signature");
			});

			const response = await t.fetch("/stripe/connected-webhook", {
				method: "POST",
				headers: { "stripe-signature": "sig_bad" },
				body: "{}",
			});

			expect(response.status).toBe(400);
			const events = await t.run(async (ctx) => ctx.db.query("stripeWebhookEvents").collect());
			expect(events).toHaveLength(0);
			errorSpy.mockRestore();
		});
	});

	describe("payout.failed", () => {
		it("stores the payout, alerts Tavli once, and tells every manager once", async () => {
			const t = harness();
			const restaurantId = await seedRestaurant(t);

			await deliver(
				t,
				payoutEvent({
					eventId: "evt_failed_1",
					type: "payout.failed",
					payout: payout({
						id: "po_failed_1",
						amount: 12_345_00,
						status: "failed",
						failureCode: "invalid_account_number",
						failureMessage: "The CLABE is not valid.",
					}),
				})
			);

			const { payouts, alerts, notifications } = await t.run(async (ctx) => ({
				payouts: await ctx.db.query("stripePayouts").collect(),
				alerts: await ctx.db.query("operatorAlerts").collect(),
				notifications: await ctx.db.query("notifications").collect(),
			}));

			expect(payouts).toHaveLength(1);
			expect(payouts[0]).toMatchObject({
				restaurantId,
				stripeAccountId: ACCOUNT,
				stripePayoutId: "po_failed_1",
				amount: 12_345_00,
				currency: "MXN",
				status: "failed",
				failureCode: "invalid_account_number",
				// The raw Stripe sentence is stored for operators…
				failureMessage: "The CLABE is not valid.",
				failureBalanceTransaction: "txn_reversal_1",
			});

			expect(alerts).toHaveLength(1);
			expect(alerts[0]).toMatchObject({
				kind: "payout_failed",
				severity: "severe",
				status: "open",
				restaurantId,
				stripeObjectId: "po_failed_1",
				dedupeKey: "payout_failed:po_failed_1",
			});

			// One row per recipient: the restaurant's owner and the active manager.
			expect(notifications).toHaveLength(2);
			expect(new Set(notifications.map((row) => row.userId))).toEqual(
				new Set([OWNER, "manager-payouts"])
			);
			for (const row of notifications) {
				expect(row).toMatchObject({
					kind: "payout_failed",
					restaurantId,
					href: "/admin/payouts",
					dedupeKey: "payout_failed:po_failed_1",
					messageKey: "payouts.notification.failed",
				});
				// Amount and currency travel as params, never as prose.
				expect(row.messageParams).toEqual({ amount: "12,345.00", currency: "MXN" });
			}
		});

		it("schedules exactly one email per manager with an address", async () => {
			const t = harness();
			await seedRestaurant(t);

			await deliver(
				t,
				payoutEvent({
					eventId: "evt_failed_email",
					type: "payout.failed",
					payout: payout({ id: "po_failed_email", status: "failed", failureCode: "no_account" }),
				})
			);

			// `t.finishInProgressScheduledFunctions` would run them; what matters
			// here is that one job exists per recipient, addressed and localized.
			const jobs = await t.run(async (ctx) =>
				ctx.db.system.query("_scheduled_functions").collect()
			);
			const payoutEmails = jobs.filter((job) => job.name.includes("sendPayoutEmail"));
			expect(payoutEmails).toHaveLength(2);
			const addressed = payoutEmails.map(
				(job) => (job.args[0] as { email: string; kind: string }).email
			);
			expect(new Set(addressed)).toEqual(new Set(["owner@example.com", "manager@example.com"]));
			expect((payoutEmails[0].args[0] as { failureCode: string }).failureCode).toBe("no_account");
		});

		it("is a complete no-op when the same event is delivered twice", async () => {
			const t = harness();
			await seedRestaurant(t);

			const event = payoutEvent({
				eventId: "evt_failed_replay",
				type: "payout.failed",
				payout: payout({ id: "po_failed_replay", status: "failed", failureCode: "declined" }),
			});
			await deliver(t, event);
			await deliver(t, event);

			const { events, payouts, alerts, notifications, jobs } = await t.run(async (ctx) => ({
				events: await ctx.db.query("stripeWebhookEvents").collect(),
				payouts: await ctx.db.query("stripePayouts").collect(),
				alerts: await ctx.db.query("operatorAlerts").collect(),
				notifications: await ctx.db.query("notifications").collect(),
				jobs: await ctx.db.system.query("_scheduled_functions").collect(),
			}));

			expect(events).toHaveLength(1);
			expect(payouts).toHaveLength(1);
			expect(alerts).toHaveLength(1);
			expect(notifications).toHaveLength(2);
			expect(jobs.filter((job) => job.name.includes("sendPayoutEmail"))).toHaveLength(2);
		});

		it("does not ring the bell again when a later event repeats an already-failed status", async () => {
			const t = harness();
			await seedRestaurant(t);

			await deliver(
				t,
				payoutEvent({
					eventId: "evt_failed_first",
					type: "payout.failed",
					payout: payout({ id: "po_twice", status: "failed", failureCode: "could_not_process" }),
				})
			);
			// A different event id about the same payout — event-id dedup does not
			// help here, only the "became failed" transition test does.
			await deliver(
				t,
				payoutEvent({
					eventId: "evt_failed_update",
					type: "payout.updated",
					payout: payout({ id: "po_twice", status: "failed", failureCode: "declined" }),
				})
			);

			const { payouts, alerts, notifications } = await t.run(async (ctx) => ({
				payouts: await ctx.db.query("stripePayouts").collect(),
				alerts: await ctx.db.query("operatorAlerts").collect(),
				notifications: await ctx.db.query("notifications").collect(),
			}));

			expect(payouts).toHaveLength(1);
			// The update DID refresh the failure detail — that is why same-status
			// events still apply.
			expect(payouts[0].failureCode).toBe("declined");
			expect(alerts).toHaveLength(1);
			expect(notifications).toHaveLength(2);
		});
	});

	describe("routine payouts", () => {
		it("records a created → in_transit → paid life with no notification and no alert", async () => {
			const t = harness();
			await seedRestaurant(t);

			for (const [index, status] of ["pending", "in_transit", "paid"].entries()) {
				await deliver(
					t,
					payoutEvent({
						eventId: `evt_routine_${index}`,
						type: index === 2 ? "payout.paid" : "payout.updated",
						payout: payout({ id: "po_routine", status }),
					})
				);
			}

			const { payouts, alerts, notifications } = await t.run(async (ctx) => ({
				payouts: await ctx.db.query("stripePayouts").collect(),
				alerts: await ctx.db.query("operatorAlerts").collect(),
				notifications: await ctx.db.query("notifications").collect(),
			}));

			expect(payouts).toHaveLength(1);
			expect(payouts[0].status).toBe("paid");
			expect(alerts).toHaveLength(0);
			expect(notifications).toHaveLength(0);
		});

		it("never lets an out-of-order created event downgrade a failed payout", async () => {
			const t = harness();
			await seedRestaurant(t);
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			await deliver(
				t,
				payoutEvent({
					eventId: "evt_oo_failed",
					type: "payout.failed",
					payout: payout({ id: "po_oo", status: "failed", failureCode: "account_closed" }),
				})
			);
			// The `payout.created` delivery that lost the race.
			await deliver(
				t,
				payoutEvent({
					eventId: "evt_oo_created",
					type: "payout.created",
					payout: payout({ id: "po_oo", status: "pending" }),
				})
			);

			const payouts = await t.run(async (ctx) => ctx.db.query("stripePayouts").collect());
			expect(payouts).toHaveLength(1);
			expect(payouts[0].status).toBe("failed");
			expect(payouts[0].failureCode).toBe("account_closed");
			expect(logSpy.mock.calls.flat().join(" ")).toContain("out-of-order");
			logSpy.mockRestore();
		});

		it("logs an unhandled connected-account type and still records it for dedup", async () => {
			const t = harness();
			await seedRestaurant(t);
			const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

			await deliver(
				t,
				payoutEvent({
					eventId: "evt_other",
					type: "balance.available",
					payout: { id: "ba_1", object: "balance" },
				})
			);

			expect(infoSpy.mock.calls.flat().join(" ")).toContain("balance.available");
			const { events, payouts } = await t.run(async (ctx) => ({
				events: await ctx.db.query("stripeWebhookEvents").collect(),
				payouts: await ctx.db.query("stripePayouts").collect(),
			}));
			expect(events).toHaveLength(1);
			expect(payouts).toHaveLength(0);
			infoSpy.mockRestore();
		});
	});

	describe("an account no restaurant claims", () => {
		it("records and logs a routine payout without alerting", async () => {
			const t = harness();
			await seedRestaurant(t, { stripeAccountId: "acct_ours" });
			const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

			await deliver(
				t,
				payoutEvent({
					eventId: "evt_unclaimed_paid",
					type: "payout.paid",
					account: "acct_other_environment",
					payout: payout({ id: "po_unclaimed_1", status: "paid" }),
				})
			);

			const { events, payouts, alerts } = await t.run(async (ctx) => ({
				events: await ctx.db.query("stripeWebhookEvents").collect(),
				payouts: await ctx.db.query("stripePayouts").collect(),
				alerts: await ctx.db.query("operatorAlerts").collect(),
			}));

			// Dev and staging share one Stripe test account: this is routine noise.
			expect(events).toHaveLength(1);
			expect(payouts).toHaveLength(0);
			expect(alerts).toHaveLength(0);
			expect(infoSpy.mock.calls.flat().join(" ")).toContain("no restaurant claims");
			infoSpy.mockRestore();
		});

		it("raises a WARNING alert with the account id when the unclaimed payout failed", async () => {
			const t = harness();
			await seedRestaurant(t, { stripeAccountId: "acct_ours" });
			const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

			await deliver(
				t,
				payoutEvent({
					eventId: "evt_unclaimed_failed",
					type: "payout.failed",
					account: "acct_other_environment",
					payout: payout({
						id: "po_unclaimed_2",
						status: "failed",
						failureCode: "bank_account_restricted",
					}),
				})
			);

			const alerts = await t.run(async (ctx) => ctx.db.query("operatorAlerts").collect());
			expect(alerts).toHaveLength(1);
			expect(alerts[0]).toMatchObject({
				kind: "payout_failed",
				// Not severe: severe emails every platform admin, and this is
				// usually the other environment's account.
				severity: "warning",
				stripeObjectId: "acct_other_environment",
				dedupeKey: "payout_failed_unclaimed:po_unclaimed_2",
			});
			expect(alerts[0].restaurantId).toBeUndefined();

			// No row was written, because no restaurant owns it.
			const payouts = await t.run(async (ctx) => ctx.db.query("stripePayouts").collect());
			expect(payouts).toHaveLength(0);
			infoSpy.mockRestore();
		});
	});

	describe("the held total and payouts resuming", () => {
		it("holds a failed payout, then clears it on a later, larger paid payout", async () => {
			const t = harness();
			const restaurantId = await seedRestaurant(t);

			await deliver(
				t,
				payoutEvent({
					eventId: "evt_held_failed",
					type: "payout.failed",
					payout: payout({
						id: "po_held_1",
						amount: 1_000_00,
						status: "failed",
						created: 1_700_000_000,
						failureCode: "invalid_account_number",
					}),
				})
			);

			const heldWhileStuck = await t
				.withIdentity({ subject: OWNER })
				.query(api.payouts.getHeldTotal, { restaurantId });
			expect(heldWhileStuck[0]).toMatchObject({
				heldCents: 1_000_00,
				unresolvedPayoutIds: ["po_held_1"],
				currency: "MXN",
			});

			// Stripe does not retry a failed payout — it creates a NEW one once the
			// bank details are fixed, sweeping the whole balance.
			await deliver(
				t,
				payoutEvent({
					eventId: "evt_held_paid",
					type: "payout.paid",
					payout: payout({
						id: "po_held_2",
						amount: 1_400_00,
						status: "paid",
						created: 1_700_600_000,
					}),
				})
			);

			const heldAfter = await t
				.withIdentity({ subject: OWNER })
				.query(api.payouts.getHeldTotal, { restaurantId });
			expect(heldAfter[0]).toMatchObject({ heldCents: 0, unresolvedPayoutIds: [] });

			// …and the managers were told payouts are flowing again, once each.
			const notifications = await t.run(async (ctx) => ctx.db.query("notifications").collect());
			const resumed = notifications.filter((row) => row.kind === "payouts_resumed");
			expect(resumed).toHaveLength(2);
			expect(resumed[0]).toMatchObject({
				href: "/admin/payouts",
				dedupeKey: "payouts_resumed:po_held_2",
				messageKey: "payouts.notification.resumed",
			});
		});

		it("resolves, and says payouts resumed, even when the recovery payout is SMALLER", async () => {
			const t = harness();
			const restaurantId = await seedRestaurant(t);

			await deliver(
				t,
				payoutEvent({
					eventId: "evt_small_failed",
					type: "payout.failed",
					payout: payout({
						id: "po_small_1",
						amount: 1_000_00,
						status: "failed",
						created: 1_700_000_000,
						failureCode: "no_account",
					}),
				})
			);
			// A refund or a lost dispute shrank the balance between the two, or
			// Stripe settled it across two payouts. The money left either way, and
			// an "at least as large" rule would hold it on the page forever and
			// never tell the restaurant it was over.
			await deliver(
				t,
				payoutEvent({
					eventId: "evt_small_paid",
					type: "payout.paid",
					payout: payout({
						id: "po_small_2",
						amount: 100_00,
						status: "paid",
						created: 1_700_600_000,
					}),
				})
			);

			const held = await t
				.withIdentity({ subject: OWNER })
				.query(api.payouts.getHeldTotal, { restaurantId });
			expect(held[0]?.heldCents).toBe(0);

			const resumed = await t.run(async (ctx) =>
				ctx.db
					.query("notifications")
					.collect()
					.then((rows) => rows.filter((row) => row.kind === "payouts_resumed"))
			);
			expect(resumed).toHaveLength(2);
		});

		it("stays quiet when a failure arrives already superseded by a later paid payout", async () => {
			const t = harness();
			const restaurantId = await seedRestaurant(t);

			// Tuesday's successful payout is delivered first…
			await deliver(
				t,
				payoutEvent({
					eventId: "evt_late_paid",
					type: "payout.paid",
					payout: payout({
						id: "po_late_paid",
						amount: 2_000_00,
						status: "paid",
						created: 1_700_600_000,
					}),
				})
			);
			// …and Monday's failure lands behind it. It really happened, so the row
			// is written — but the money is not stuck any more, and telling a
			// manager about it would ring a bell for a problem that was over before
			// they heard of it, and leave a severe alert to acknowledge.
			await deliver(
				t,
				payoutEvent({
					eventId: "evt_late_failed",
					type: "payout.failed",
					payout: payout({
						id: "po_late_failed",
						amount: 1_000_00,
						status: "failed",
						created: 1_700_000_000,
						failureCode: "no_account",
					}),
				})
			);

			const { payouts, alerts, notifications, jobs } = await t.run(async (ctx) => ({
				payouts: await ctx.db.query("stripePayouts").collect(),
				alerts: await ctx.db.query("operatorAlerts").collect(),
				notifications: await ctx.db.query("notifications").collect(),
				jobs: await ctx.db.system.query("_scheduled_functions").collect(),
			}));

			expect(payouts).toHaveLength(2);
			expect(alerts).toHaveLength(0);
			expect(notifications).toHaveLength(0);
			expect(jobs.filter((job) => job.name.includes("sendPayoutEmail"))).toHaveLength(0);

			const held = await t
				.withIdentity({ subject: OWNER })
				.query(api.payouts.getHeldTotal, { restaurantId });
			expect(held[0]?.heldCents).toBe(0);
		});

		it("counts only the newest failure when the next sweep fails too", async () => {
			const t = harness();
			const restaurantId = await seedRestaurant(t);

			// Monday: 1,000 bounces.
			await deliver(
				t,
				payoutEvent({
					eventId: "evt_sweep_1",
					type: "payout.failed",
					payout: payout({
						id: "po_sweep_1",
						amount: 1_000_00,
						status: "failed",
						created: 1_700_000_000,
						failureCode: "no_account",
					}),
				})
			);
			// Tuesday: the automatic payout sweeps the WHOLE available balance —
			// Monday's 1,000 plus 200 of new sales — and bounces again.
			await deliver(
				t,
				payoutEvent({
					eventId: "evt_sweep_2",
					type: "payout.failed",
					payout: payout({
						id: "po_sweep_2",
						amount: 1_200_00,
						status: "failed",
						created: 1_700_600_000,
						failureCode: "no_account",
					}),
				})
			);

			const held = await t
				.withIdentity({ subject: OWNER })
				.query(api.payouts.getHeldTotal, { restaurantId });
			// 1,200 is stuck. 2,200 was never stuck — that would be counting
			// Monday's money twice.
			expect(held[0]?.heldCents).toBe(1_200_00);
			expect(held[0]?.unresolvedPayoutIds).toEqual(["po_sweep_2"]);

			// Both failures are real events, so both were told and both alerted.
			const { alerts, notifications } = await t.run(async (ctx) => ({
				alerts: await ctx.db.query("operatorAlerts").collect(),
				notifications: await ctx.db.query("notifications").collect(),
			}));
			expect(alerts).toHaveLength(2);
			expect(notifications).toHaveLength(4);
		});

		it("resolves the held total even when the paid event for a DIFFERENT payout arrives first", async () => {
			const t = harness();
			const restaurantId = await seedRestaurant(t);

			// The replacement payout's `paid` event is delivered before the older
			// failure's — different payouts, so status rank cannot order them; the
			// held total is computed from Stripe's `created`, which can.
			await deliver(
				t,
				payoutEvent({
					eventId: "evt_ooo_paid",
					type: "payout.paid",
					payout: payout({
						id: "po_ooo_new",
						amount: 2_000_00,
						status: "paid",
						created: 1_700_600_000,
					}),
				})
			);
			await deliver(
				t,
				payoutEvent({
					eventId: "evt_ooo_failed",
					type: "payout.failed",
					payout: payout({
						id: "po_ooo_old",
						amount: 1_000_00,
						status: "failed",
						created: 1_700_000_000,
						failureCode: "could_not_process",
					}),
				})
			);

			const held = await t
				.withIdentity({ subject: OWNER })
				.query(api.payouts.getHeldTotal, { restaurantId });
			expect(held[0]?.heldCents).toBe(0);

			// The failure is recorded — it really happened, and it is on the payouts
			// page — but nobody is told: the money it was about has already moved,
			// so a bell row and a severe alert would be work created about a
			// problem that was over before anyone heard of it.
			const { alerts, notifications } = await t.run(async (ctx) => ({
				alerts: await ctx.db.query("operatorAlerts").collect(),
				notifications: await ctx.db.query("notifications").collect(),
			}));
			expect(alerts).toHaveLength(0);
			expect(notifications).toHaveLength(0);
			const rows = await t.run(async (ctx) => ctx.db.query("stripePayouts").collect());
			expect(rows).toHaveLength(2);
		});
	});

	describe("the payouts page query", () => {
		it("lists payouts newest first, maps the failure code, and never returns Stripe's sentence", async () => {
			const t = harness();
			const restaurantId = await seedRestaurant(t);

			await deliver(
				t,
				payoutEvent({
					eventId: "evt_list_1",
					type: "payout.paid",
					payout: payout({ id: "po_list_old", status: "paid", created: 1_700_000_000 }),
				})
			);
			await deliver(
				t,
				payoutEvent({
					eventId: "evt_list_2",
					type: "payout.failed",
					payout: payout({
						id: "po_list_new",
						status: "failed",
						created: 1_700_900_000,
						failureCode: "debit_not_authorized",
						failureMessage: "The account holder has not authorized debits.",
					}),
				})
			);

			const [data, error] = await t
				.withIdentity({ subject: OWNER })
				.query(api.payouts.listByRestaurant, { restaurantId });
			expect(error).toBeNull();
			expect(data?.rows.map((row) => row.stripePayoutId)).toEqual(["po_list_new", "po_list_old"]);
			expect(data?.rows[0]).toMatchObject({
				status: "failed",
				failureCode: "debit_not_authorized",
			});
			expect(data?.rows[1].failureCode).toBeUndefined();
			expect(data?.held.heldCents).toBe(250_00);
			expect(data?.hasStripeAccount).toBe(true);

			// The raw Stripe sentence is operators-only and must not be in the payload.
			expect(JSON.stringify(data)).not.toContain("has not authorized debits");
		});

		it("maps an undocumented Stripe failure code to unknown rather than leaking it", async () => {
			const t = harness();
			const restaurantId = await seedRestaurant(t);

			await deliver(
				t,
				payoutEvent({
					eventId: "evt_unknown_code",
					type: "payout.failed",
					payout: payout({
						id: "po_unknown_code",
						status: "failed",
						failureCode: "teleportation_declined",
					}),
				})
			);

			const [data] = await t
				.withIdentity({ subject: OWNER })
				.query(api.payouts.listByRestaurant, { restaurantId });
			expect(data?.rows[0].failureCode).toBe("unknown");
			expect(JSON.stringify(data)).not.toContain("teleportation");
		});

		it("refuses an employee of the restaurant", async () => {
			const t = harness();
			const restaurantId = await seedRestaurant(t);
			await t.run(async (ctx) => {
				const restaurant = await ctx.db.get(restaurantId);
				await ctx.db.insert("userRoles", {
					userId: "server-1",
					organizationId: restaurant!.organizationId,
					roles: ["employee"],
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				await ctx.db.insert("restaurantMembers", {
					restaurantId,
					organizationId: restaurant!.organizationId,
					userId: "server-1",
					role: "employee",
					isActive: true,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
			});

			const [data, error] = await t
				.withIdentity({ subject: "server-1" })
				.query(api.payouts.listByRestaurant, { restaurantId });
			expect(data).toBeNull();
			expect(error).not.toBeNull();
		});

		it("refuses an anonymous reader", async () => {
			const t = harness();
			const restaurantId = await seedRestaurant(t);
			const [data, error] = await t.query(api.payouts.listByRestaurant, { restaurantId });
			expect(data).toBeNull();
			expect(error).not.toBeNull();
		});
	});

	describe("the restaurant purge", () => {
		it("takes the payout rows with it", async () => {
			const t = harness();
			const restaurantId = await seedRestaurant(t);

			await deliver(
				t,
				payoutEvent({
					eventId: "evt_purge",
					type: "payout.failed",
					payout: payout({ id: "po_purge", status: "failed", failureCode: "account_frozen" }),
				})
			);
			expect(await t.run(async (ctx) => ctx.db.query("stripePayouts").collect())).toHaveLength(1);

			// The purge only runs on a soft-deleted restaurant.
			await t.run(async (ctx) => {
				await ctx.db.patch(restaurantId, { deletedAt: Date.now() });
			});
			await t.mutation(internal.restaurantPurge.purgeRestaurantInternal, { restaurantId });

			expect(await t.run(async (ctx) => ctx.db.query("stripePayouts").collect())).toHaveLength(0);
		});
	});
});
