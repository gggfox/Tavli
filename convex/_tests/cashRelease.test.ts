/**
 * `restaurants.releaseCashOrdersImmediately` — the per-restaurant cash policy
 * (TAVLI-81, ADR 008 addendum).
 *
 * Two halves, and the first matters as much as the second: **off** has to be
 * ADR 008 exactly as it shipped, because that is what every existing
 * restaurant runs and what the toggle promises not to disturb.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
	allowedOrderTransitions,
	hasStationTicket,
	owesInPersonPayment,
	releasesCashOrdersImmediately,
} from "../orderHelpers";
import { insertMenuForRestaurant } from "../menus";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

/**
 * A restaurant with an owner, one table, an active session, one kitchen menu
 * item, and a cash round already committed by the diner.
 */
async function seedCashOrder(
	t: ReturnType<typeof convexTest>,
	options: { releaseCashOrdersImmediately?: boolean } = {}
) {
	let organizationId: Id<"organizations">;
	let restaurantId: Id<"restaurants">;
	let tableId: Id<"tables">;
	let sessionId: Id<"sessions">;
	let menuItemId: Id<"menuItems">;

	await t.run(async (ctx) => {
		organizationId = await ctx.db.insert("organizations", {
			name: "Test Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});

		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner1",
			organizationId,
			name: "Test Restaurant",
			slug: "test-r",
			currency: "USD",
			isActive: true,
			...(options.releaseCashOrdersImmediately !== undefined && {
				releaseCashOrdersImmediately: options.releaseCashOrdersImmediately,
			}),
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});

		await ctx.db.insert("userRoles", {
			userId: "owner1",
			roles: ["owner"],
			organizationId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});

		const menuId = await insertMenuForRestaurant(ctx, {
			restaurantId,
			name: "main",
			userId: "owner1",
		});
		const categoryId = await ctx.db.insert("menuCategories", {
			menuId,
			restaurantId,
			name: "Starters",
			displayOrder: 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		menuItemId = await ctx.db.insert("menuItems", {
			categoryId,
			restaurantId,
			name: "Tacos",
			basePrice: 600,
			isAvailable: true,
			displayOrder: 0,
			prepStation: "kitchen",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});

		tableId = await ctx.db.insert("tables", {
			restaurantId,
			tableNumber: 1,
			isActive: true,
			createdAt: Date.now(),
		});
		sessionId = await ctx.db.insert("sessions", {
			restaurantId,
			tableId,
			userId: "diner1",
			status: "active",
			startedAt: Date.now(),
		});
	});

	const diner = t.withIdentity({ subject: "diner1" });
	const staff = t.withIdentity({ subject: "owner1" });

	const orderId = await diner.mutation(api.orders.createDraft, {
		sessionId: sessionId!,
		tableId: tableId!,
	});
	await diner.mutation(api.orders.addItem, {
		orderId,
		menuItemId: menuItemId!,
		quantity: 2,
		selectedOptions: [],
	});
	await diner.mutation(api.orders.requestPayInPerson, { orderId });

	return {
		organizationId: organizationId!,
		restaurantId: restaurantId!,
		tableId: tableId!,
		sessionId: sessionId!,
		menuItemId: menuItemId!,
		orderId,
		diner,
		staff,
	};
}

describe("cash release policy — pure rules", () => {
	it("treats a missing field as off, so pre-toggle restaurants are unchanged", () => {
		expect(releasesCashOrdersImmediately({})).toBe(false);
		expect(releasesCashOrdersImmediately({ releaseCashOrdersImmediately: false })).toBe(false);
		expect(releasesCashOrdersImmediately({ releaseCashOrdersImmediately: true })).toBe(true);
	});

	it("off: awaiting_payment can only be cancelled", () => {
		expect(allowedOrderTransitions("awaiting_payment", false)).toEqual(["cancelled"]);
	});

	it("on: awaiting_payment borrows submitted's row rather than copying it", () => {
		expect(allowedOrderTransitions("awaiting_payment", true)).toBe(
			allowedOrderTransitions("submitted", false)
		);
	});

	it("only awaiting_payment is affected by the policy", () => {
		for (const status of ["submitted", "preparing", "ready", "served", "cancelled"]) {
			expect(allowedOrderTransitions(status, true)).toEqual(allowedOrderTransitions(status, false));
		}
	});

	it("keeps a released round off the rail until the policy says otherwise", () => {
		const base = { status: "awaiting_payment", stationStamp: undefined, liveStationItemCount: 1 };
		expect(hasStationTicket(base)).toBe(false);
		expect(hasStationTicket({ ...base, cashReleasedImmediately: false })).toBe(false);
		expect(hasStationTicket({ ...base, cashReleasedImmediately: true })).toBe(true);
		// The other two rail rules still apply to a released round.
		expect(hasStationTicket({ ...base, cashReleasedImmediately: true, stationStamp: 1 })).toBe(
			false
		);
		expect(
			hasStationTicket({ ...base, cashReleasedImmediately: true, liveStationItemCount: 0 })
		).toBe(false);
	});

	describe("owesInPersonPayment", () => {
		it("is true for an uncollected cash round at every workable status", () => {
			for (const status of ["awaiting_payment", "submitted", "preparing", "ready", "served"]) {
				expect(owesInPersonPayment({ status, awaitingPaymentAt: 1_000 })).toBe(true);
			}
		});

		it("is false once the cash is collected, and stays false after a refund", () => {
			expect(owesInPersonPayment({ status: "preparing", awaitingPaymentAt: 1, paidAt: 2 })).toBe(
				false
			);
			// A refunded cash order was collected — the table owes nothing more.
			expect(owesInPersonPayment({ status: "served", awaitingPaymentAt: 1, paidAt: 2 })).toBe(
				false
			);
		});

		it("never fires for a card order, a draft, or a cancelled round", () => {
			expect(owesInPersonPayment({ status: "submitted" })).toBe(false);
			expect(owesInPersonPayment({ status: "draft", awaitingPaymentAt: 1 })).toBe(false);
			expect(owesInPersonPayment({ status: "cancelled", awaitingPaymentAt: 1 })).toBe(false);
		});
	});
});

describe("cash release policy OFF (ADR 008 default)", () => {
	it("refuses to advance an uncollected round", async () => {
		const t = convexTest(schema, modules);
		const { orderId, staff } = await seedCashOrder(t);

		await expect(
			staff.mutation(api.orders.updateStatus, { orderId, newStatus: "preparing" })
		).rejects.toThrow(/Cannot transition from awaiting_payment/);
	});

	it("refuses a station stamp on an uncollected round", async () => {
		const t = convexTest(schema, modules);
		const { orderId, staff } = await seedCashOrder(t);

		await expect(
			staff.mutation(api.orders.markStationReady, { orderId, station: "kitchen" })
		).rejects.toThrow();
	});

	it("counts the round as a card, never as rail work", async () => {
		const t = convexTest(schema, modules);
		const { orderId, restaurantId, staff } = await seedCashOrder(t);
		// A stamped station bumps a ticket off the rail but leaves a card
		// standing, so this is what tells the two counting paths apart.
		await t.run(async (ctx) => ctx.db.patch(orderId, { kitchenReadyAt: Date.now() }));

		const [counts] = await staff.query(api.orders.getDashboardStatusCounts, {
			restaurantId,
			prepStations: ["kitchen"],
		});
		expect(counts?.awaiting_payment.count).toBe(1);

		// The query is untyped at the tuple level (no `AsyncReturn` annotation),
		// so name the one field this test is about rather than the whole shape.
		const [orders] = await staff.query(api.orders.getActiveOrdersByRestaurant, {
			restaurantId,
			statuses: ["awaiting_payment"],
		});
		const cards = orders as Array<{ cashReleasedImmediately: boolean }>;
		expect(cards).toHaveLength(1);
		expect(cards[0]?.cashReleasedImmediately).toBe(false);
	});

	it("releases to submitted on collection, exactly as before", async () => {
		const t = convexTest(schema, modules);
		const { orderId, staff } = await seedCashOrder(t);

		const [, error] = await staff.mutation(api.orders.markOrderPaidInPerson, { orderId });
		expect(error).toBeNull();

		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.status).toBe("submitted");
		expect(order?.paymentState).toBe("paid");
		expect(order?.settledBy).toBe("staff");
		expect(order?.paidAt).toBeTypeOf("number");
		expect(order?.submittedAt).toBeTypeOf("number");
	});
});

describe("cash release policy ON", () => {
	it("advances an uncollected round like a submitted one", async () => {
		const t = convexTest(schema, modules);
		const { orderId, staff } = await seedCashOrder(t, { releaseCashOrdersImmediately: true });

		const [, error] = await staff.mutation(api.orders.updateStatus, {
			orderId,
			newStatus: "preparing",
		});
		expect(error).toBeNull();

		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.status).toBe("preparing");
		// Still owed: the debt moved off `status` and onto these two fields.
		expect(order?.awaitingPaymentAt).toBeTypeOf("number");
		expect(order?.paidAt).toBeUndefined();
	});

	it("still refuses to skip a step", async () => {
		const t = convexTest(schema, modules);
		const { orderId, staff } = await seedCashOrder(t, { releaseCashOrdersImmediately: true });

		await expect(
			staff.mutation(api.orders.updateStatus, { orderId, newStatus: "served" })
		).rejects.toThrow(/Cannot transition from awaiting_payment/);
	});

	it("lets the station that cooked it stamp it ready", async () => {
		const t = convexTest(schema, modules);
		const { orderId, staff } = await seedCashOrder(t, { releaseCashOrdersImmediately: true });

		const [, error] = await staff.mutation(api.orders.markStationReady, {
			orderId,
			station: "kitchen",
		});
		expect(error).toBeNull();

		const order = await t.run(async (ctx) => ctx.db.get(orderId));
		expect(order?.kitchenReadyAt).toBeTypeOf("number");
		// Kitchen is the only applicable station, so the whole round is ready.
		expect(order?.status).toBe("ready");
	});

	it("counts the round as rail work, which a station stamp then bumps", async () => {
		const t = convexTest(schema, modules);
		const { orderId, restaurantId, staff } = await seedCashOrder(t, {
			releaseCashOrdersImmediately: true,
		});

		const [before] = await staff.query(api.orders.getDashboardStatusCounts, {
			restaurantId,
			prepStations: ["kitchen"],
		});
		expect(before?.awaiting_payment.count).toBe(1);

		// The rail rule the card path does not have: a stamped ticket leaves.
		await t.run(async (ctx) => ctx.db.patch(orderId, { kitchenReadyAt: Date.now() }));
		const [after] = await staff.query(api.orders.getDashboardStatusCounts, {
			restaurantId,
			prepStations: ["kitchen"],
		});
		expect(after?.awaiting_payment.count).toBe(0);

		// The query is untyped at the tuple level (no `AsyncReturn` annotation),
		// so name the one field this test is about rather than the whole shape.
		const [orders] = await staff.query(api.orders.getActiveOrdersByRestaurant, {
			restaurantId,
			statuses: ["awaiting_payment"],
		});
		const cards = orders as Array<{ cashReleasedImmediately: boolean }>;
		expect(cards).toHaveLength(1);
		expect(cards[0]?.cashReleasedImmediately).toBe(true);
	});

	describe("mark paid in person, at every stage", () => {
		it("collects from awaiting_payment and releases, as ever", async () => {
			const t = convexTest(schema, modules);
			const { orderId, staff } = await seedCashOrder(t, { releaseCashOrdersImmediately: true });

			await staff.mutation(api.orders.markOrderPaidInPerson, { orderId });

			const order = await t.run(async (ctx) => ctx.db.get(orderId));
			expect(order?.status).toBe("submitted");
			expect(order?.submittedAt).toBeTypeOf("number");
		});

		it.each(["preparing", "ready", "served"] as const)(
			"collects from %s without rewinding the kitchen",
			async (target) => {
				const t = convexTest(schema, modules);
				const { orderId, staff } = await seedCashOrder(t, { releaseCashOrdersImmediately: true });

				for (const step of ["preparing", "ready", "served"] as const) {
					await staff.mutation(api.orders.updateStatus, { orderId, newStatus: step });
					if (step === target) break;
				}

				const [, error] = await staff.mutation(api.orders.markOrderPaidInPerson, { orderId });
				expect(error).toBeNull();

				const order = await t.run(async (ctx) => ctx.db.get(orderId));
				expect(order?.status).toBe(target);
				expect(order?.paymentState).toBe("paid");
				expect(order?.settledBy).toBe("staff");
				expect(order?.paidAt).toBeTypeOf("number");
				// Releasing is what `submittedAt` records, and the kitchen was
				// never held back here — so nothing to record.
				expect(order?.submittedAt).toBeUndefined();
			}
		);

		it("refuses a second collection", async () => {
			const t = convexTest(schema, modules);
			const { orderId, staff } = await seedCashOrder(t, { releaseCashOrdersImmediately: true });
			await staff.mutation(api.orders.updateStatus, { orderId, newStatus: "preparing" });
			await staff.mutation(api.orders.markOrderPaidInPerson, { orderId });

			await expect(staff.mutation(api.orders.markOrderPaidInPerson, { orderId })).rejects.toThrow(
				/ERROR_ORDER_NOT_AWAITING_PAYMENT/
			);
		});

		it("writes no payments row, wherever it is collected", async () => {
			const t = convexTest(schema, modules);
			const { orderId, staff } = await seedCashOrder(t, { releaseCashOrdersImmediately: true });
			await staff.mutation(api.orders.updateStatus, { orderId, newStatus: "preparing" });
			await staff.mutation(api.orders.markOrderPaidInPerson, { orderId });

			const payments = await t.run(async (ctx) => ctx.db.query("payments").collect());
			expect(payments).toHaveLength(0);
		});
	});

	describe("the session still knows the table owes", () => {
		it("blocks close-out while a released round is uncollected", async () => {
			const t = convexTest(schema, modules);
			const { orderId, sessionId, staff, diner } = await seedCashOrder(t, {
				releaseCashOrdersImmediately: true,
			});
			await staff.mutation(api.orders.updateStatus, { orderId, newStatus: "preparing" });

			await expect(diner.mutation(api.sessions.close, { sessionId })).rejects.toThrow(
				/ERROR_SESSION_AWAITING_PAYMENT_ORDERS/
			);
		});

		it("unblocks close-out once the cash is collected", async () => {
			const t = convexTest(schema, modules);
			const { orderId, sessionId, staff, diner } = await seedCashOrder(t, {
				releaseCashOrdersImmediately: true,
			});
			await staff.mutation(api.orders.updateStatus, { orderId, newStatus: "preparing" });
			await staff.mutation(api.orders.markOrderPaidInPerson, { orderId });

			await diner.mutation(api.sessions.close, { sessionId });

			const session = await t.run(async (ctx) => ctx.db.get(sessionId));
			expect(session?.status).toBe("closed");
		});

		it("flags — never closes — a stale visit whose released round is uncollected", async () => {
			const t = convexTest(schema, modules);
			const { orderId, sessionId, staff } = await seedCashOrder(t, {
				releaseCashOrdersImmediately: true,
			});
			// Advancing is exactly what used to make the sweep blind: the round
			// leaves `awaiting_payment` while still owing.
			await staff.mutation(api.orders.updateStatus, { orderId, newStatus: "preparing" });
			await t.run(async (ctx) => {
				await ctx.db.patch(sessionId, { startedAt: Date.now() - 26 * 60 * 60 * 1000 });
			});

			const result = await t.mutation(internal.sessions.sweepStaleOpenTabs, {});

			expect(result.closed).toBe(0);
			expect(result.flagged).toBe(1);
			expect(result.awaitingPaymentOrdersSeen).toBe(1);
			const session = await t.run(async (ctx) => ctx.db.get(sessionId));
			expect(session?.status).toBe("active");
			expect(session?.flaggedStaleAt).toBeDefined();
		});

		it("lets the sweep close the visit once the cash is collected", async () => {
			const t = convexTest(schema, modules);
			const { orderId, sessionId, staff } = await seedCashOrder(t, {
				releaseCashOrdersImmediately: true,
			});
			await staff.mutation(api.orders.updateStatus, { orderId, newStatus: "preparing" });
			await staff.mutation(api.orders.markOrderPaidInPerson, { orderId });
			await t.run(async (ctx) => {
				await ctx.db.patch(sessionId, { startedAt: Date.now() - 26 * 60 * 60 * 1000 });
			});

			const result = await t.mutation(internal.sessions.sweepStaleOpenTabs, {});

			expect(result.closed).toBe(1);
			const session = await t.run(async (ctx) => ctx.db.get(sessionId));
			expect(session?.status).toBe("closed");
		});

		it("keeps uncollected cash out of the legacy tab balance", async () => {
			const t = convexTest(schema, modules);
			const { orderId, sessionId, staff, diner } = await seedCashOrder(t, {
				releaseCashOrdersImmediately: true,
			});
			await staff.mutation(api.orders.updateStatus, { orderId, newStatus: "preparing" });

			// Cash can only move in person. A released round sits in a
			// tab-payable status, so the status allowlist alone stopped
			// excluding it — the tab subtotal must still read zero.
			const summary = await diner.query(api.sessions.getTabSummary, { sessionId });
			expect(summary?.subtotal).toBe(0);
			expect(summary?.payableOrderIds).toEqual([]);
		});
	});
});

describe("the flag is staff-only", () => {
	it("is not exposed to diners by the public restaurant projection", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedCashOrder(t, { releaseCashOrdersImmediately: true });

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		const publicRestaurant = await t.query(api.restaurants.getBySlug, {
			slug: restaurant!.slug,
		});

		expect(publicRestaurant).not.toBeNull();
		expect(publicRestaurant).not.toHaveProperty("releaseCashOrdersImmediately");
	});

	it("is settable by a restaurant manager, not only a platform admin", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, organizationId } = await seedCashOrder(t);

		await t.run(async (ctx) => {
			await ctx.db.insert("restaurantMembers", {
				restaurantId,
				organizationId,
				userId: "manager1",
				role: "manager",
				isActive: true,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});

		const [, error] = await t
			.withIdentity({ subject: "manager1" })
			.mutation(api.restaurants.update, {
				restaurantId,
				organizationId,
				releaseCashOrdersImmediately: true,
			});
		expect(error).toBeNull();

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.releaseCashOrdersImmediately).toBe(true);
	});
});
