/**
 * Audit coverage for the money and reservation lifecycles (TAVLI-63).
 *
 * These assert the *presence and shape* of `allEvents` rows, not the business
 * transitions themselves — those are covered in orders/sessionTabs/reservation
 * tests. The thing worth pinning here is that a transition can't quietly stop
 * emitting its event, and that the recorded actor is the caller rather than
 * whoever happened to open the tab.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { AUDIT_EVENT, AUDIT_SYSTEM_USER_ID, RESERVATION_STATUS } from "../constants";
import { insertMenuForRestaurant } from "../menus";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

type AuditRow = Doc<"allEvents">;
/** `ReturnType<typeof convexTest>` erases the schema, which loses index names. */
type TestConvex = ReturnType<typeof convexTest<(typeof schema)["tables"]>>;

function eventsFor(t: TestConvex, eventType: string): Promise<Array<AuditRow>> {
	return t.run(async (ctx) =>
		ctx.db
			.query("allEvents")
			.withIndex("by_event_type", (q) => q.eq("eventType", eventType))
			.collect()
	);
}

async function seedRestaurant(t: ReturnType<typeof convexTest>) {
	let restaurantId: Id<"restaurants">;
	let tableId: Id<"tables">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Audit Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-audit",
			organizationId,
			name: "Audit Restaurant",
			slug: "audit-r",
			currency: "USD",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await insertMenuForRestaurant(ctx, { restaurantId, name: "audit-r", userId: "owner-audit" });
		tableId = await ctx.db.insert("tables", {
			restaurantId,
			tableNumber: 1,
			capacity: 4,
			isActive: true,
			createdAt: Date.now(),
		});
	});
	return { restaurantId: restaurantId!, tableId: tableId! };
}

async function seedMenuItem(t: ReturnType<typeof convexTest>, restaurantId: Id<"restaurants">) {
	let menuItemId: Id<"menuItems">;
	await t.run(async (ctx) => {
		const menus = await ctx.db.query("menus").collect();
		const menuId = menus.find((m) => m.restaurantId === restaurantId)!._id;
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
			name: "Bruschetta",
			basePrice: 900,
			isAvailable: true,
			displayOrder: 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return menuItemId!;
}

/** Opens a tab as `dinerId` and submits one order against it. */
async function seedTabWithOrder(t: ReturnType<typeof convexTest>, dinerId = "diner1") {
	const { restaurantId, tableId } = await seedRestaurant(t);
	const menuItemId = await seedMenuItem(t, restaurantId);
	const authed = t.withIdentity({ subject: dinerId });

	const { sessionId } = await authed.mutation(api.sessions.create, { restaurantSlug: "audit-r" });
	const orderId = await authed.mutation(api.orders.createDraft, { sessionId, tableId });
	await authed.mutation(api.orders.addItem, {
		orderId,
		menuItemId,
		quantity: 2,
		selectedOptions: [],
	});
	await authed.mutation(api.orders.submitOrder, { orderId });

	return { restaurantId, tableId, sessionId, orderId, authed, dinerId };
}

describe("audit: session lifecycle", () => {
	it("records opening a tab against the diner who opened it", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedRestaurant(t);
		const authed = t.withIdentity({ subject: "diner1" });

		const { sessionId } = await authed.mutation(api.sessions.create, { restaurantSlug: "audit-r" });

		const events = await eventsFor(t, AUDIT_EVENT.SESSION_OPENED);
		expect(events).toHaveLength(1);
		expect(events[0].aggregateType).toBe("sessions");
		expect(events[0].aggregateId).toBe(sessionId);
		expect(events[0].userId).toBe("diner1");
		expect(events[0].payload).toMatchObject({ restaurantId });
	});

	it("records a join once, and not when an existing member re-enters", async () => {
		const t = convexTest(schema, modules);
		const { sessionId, authed } = await seedTabWithOrder(t);
		const tab = await authed.query(api.sessions.getTabSummary, { sessionId });
		const friend = t.withIdentity({ subject: "friend1" });

		await friend.mutation(api.sessions.joinByCode, {
			restaurantSlug: "audit-r",
			joinCode: tab!.joinCode!,
		});
		await friend.mutation(api.sessions.joinByCode, {
			restaurantSlug: "audit-r",
			joinCode: tab!.joinCode!,
		});

		const events = await eventsFor(t, AUDIT_EVENT.SESSION_JOINED);
		expect(events).toHaveLength(1);
		expect(events[0].userId).toBe("friend1");
		// Opener + the one joiner. `memberUserIds` never contains the opener, so
		// this is off by one from the array length in the row.
		expect(events[0].payload).toMatchObject({ memberCount: 2 });
	});

	it("counts each additional joiner, matching what the tab view reports", async () => {
		const t = convexTest(schema, modules);
		const { sessionId, authed } = await seedTabWithOrder(t);
		const tab = await authed.query(api.sessions.getTabSummary, { sessionId });

		for (const subject of ["friend1", "friend2"]) {
			await t.withIdentity({ subject }).mutation(api.sessions.joinByCode, {
				restaurantSlug: "audit-r",
				joinCode: tab!.joinCode!,
			});
		}

		const events = await eventsFor(t, AUDIT_EVENT.SESSION_JOINED);
		expect(events.map((e) => (e.payload as { memberCount: number }).memberCount)).toEqual([2, 3]);

		// The last event must agree with what the tab view shows the diners.
		const finalTab = await authed.query(api.sessions.getTabSummary, { sessionId });
		expect(finalTab!.memberCount).toBe(3);
	});

	it("attributes a submitted order to the member who submitted it, not the tab opener", async () => {
		const t = convexTest(schema, modules);
		const { sessionId, tableId, authed, restaurantId } = await seedTabWithOrder(t);
		const menuItemId = await seedMenuItem(t, restaurantId);
		const tab = await authed.query(api.sessions.getTabSummary, { sessionId });

		const friend = t.withIdentity({ subject: "friend1" });
		await friend.mutation(api.sessions.joinByCode, {
			restaurantSlug: "audit-r",
			joinCode: tab!.joinCode!,
		});
		const friendOrderId = await friend.mutation(api.orders.createDraft, { sessionId, tableId });
		await friend.mutation(api.orders.addItem, {
			orderId: friendOrderId,
			menuItemId,
			quantity: 1,
			selectedOptions: [],
		});
		await friend.mutation(api.orders.submitOrder, { orderId: friendOrderId });

		const events = await eventsFor(t, AUDIT_EVENT.ORDER_SUBMITTED);
		const friendEvent = events.find((e) => e.aggregateId === friendOrderId);
		// The whole point: `session.userId` is diner1, but friend1 placed this one.
		expect(friendEvent?.userId).toBe("friend1");
	});

	it("records the payment lock, the settlement, and the system as the settling actor", async () => {
		const t = convexTest(schema, modules);
		const { sessionId, restaurantId, orderId } = await seedTabWithOrder(t);

		const paymentId = await t.mutation(internal.sessions.beginTabPayment, {
			sessionId,
			restaurantId,
			userId: "diner1",
			amount: 1800 + 180,
			currency: "usd",
			gratuityAmount: 180,
		});

		const locked = await eventsFor(t, AUDIT_EVENT.SESSION_PAYMENT_LOCKED);
		expect(locked).toHaveLength(1);
		expect(locked[0].userId).toBe("diner1");
		expect(locked[0].payload).toMatchObject({
			amount: 1980,
			gratuityAmount: 180,
			attemptNumber: 1,
		});

		await t.mutation(internal.sessions.confirmTabPayment, {
			paymentId,
			stripePaymentIntentId: "pi_audit_1",
			gratuityAmount: 180,
		});

		const succeeded = await eventsFor(t, AUDIT_EVENT.SESSION_PAYMENT_SUCCEEDED);
		expect(succeeded).toHaveLength(1);
		// Webhook-originated: the actor is the system, not a spoofed diner.
		expect(succeeded[0].userId).toBe(AUDIT_SYSTEM_USER_ID);
		expect(succeeded[0].idempotencyKey).toBe("pi_audit_1");
		expect(succeeded[0].payload).toMatchObject({
			amount: 1980,
			gratuityAmount: 180,
			paidOrderIds: [orderId],
			settledBy: "stripe",
		});
	});

	it("writes no settlement event when the webhook replays after success", async () => {
		const t = convexTest(schema, modules);
		const { sessionId, restaurantId } = await seedTabWithOrder(t);
		const paymentId = await t.mutation(internal.sessions.beginTabPayment, {
			sessionId,
			restaurantId,
			userId: "diner1",
			amount: 1800,
			currency: "usd",
			gratuityAmount: 0,
		});

		await t.mutation(internal.sessions.confirmTabPayment, {
			paymentId,
			stripePaymentIntentId: "pi_audit_2",
		});
		await t.mutation(internal.sessions.confirmTabPayment, {
			paymentId,
			stripePaymentIntentId: "pi_audit_2",
		});

		expect(await eventsFor(t, AUDIT_EVENT.SESSION_PAYMENT_SUCCEEDED)).toHaveLength(1);
	});

	it("records a failed tab payment with the system as actor", async () => {
		const t = convexTest(schema, modules);
		const { sessionId, restaurantId } = await seedTabWithOrder(t);
		const paymentId = await t.mutation(internal.sessions.beginTabPayment, {
			sessionId,
			restaurantId,
			userId: "diner1",
			amount: 1800,
			currency: "usd",
			gratuityAmount: 0,
		});

		await t.mutation(internal.sessions.failTabPayment, {
			paymentId,
			stripePaymentIntentId: "pi_audit_3",
			failureCode: "card_declined",
			failureMessage: "Your card was declined.",
		});

		const events = await eventsFor(t, AUDIT_EVENT.SESSION_PAYMENT_FAILED);
		expect(events).toHaveLength(1);
		expect(events[0].userId).toBe(AUDIT_SYSTEM_USER_ID);
		expect(events[0].payload).toMatchObject({
			failureCode: "card_declined",
			unlockedTab: true,
		});
	});

	it("records the stale-tab sweep as the system, distinguishing close from flag", async () => {
		const t = convexTest(schema, modules);
		const { sessionId, restaurantId } = await seedTabWithOrder(t);

		await t.run(async (ctx) => {
			const old = Date.now() - 26 * 60 * 60 * 1000;
			await ctx.db.patch(sessionId, { startedAt: old });
			await ctx.db.insert("sessions", {
				restaurantId,
				userId: "diner2",
				status: "active",
				startedAt: old,
			});
		});

		await t.mutation(internal.sessions.sweepStaleOpenTabs, {});

		const closed = await eventsFor(t, AUDIT_EVENT.SESSION_STALE_CLOSED);
		const flagged = await eventsFor(t, AUDIT_EVENT.SESSION_STALE_FLAGGED);
		expect(closed).toHaveLength(1); // no orders -> settled, closed quietly
		expect(flagged).toHaveLength(1); // unpaid balance -> walkout candidate
		expect(flagged[0].aggregateId).toBe(sessionId);
		expect(flagged[0].userId).toBe(AUDIT_SYSTEM_USER_ID);
		expect(flagged[0].payload).toMatchObject({ unpaidTotal: 1800 });

		// Flagged once. A second sweep must not re-log the same tab.
		await t.mutation(internal.sessions.sweepStaleOpenTabs, {});
		expect(await eventsFor(t, AUDIT_EVENT.SESSION_STALE_FLAGGED)).toHaveLength(1);
	});
});

describe("audit: reservation lifecycle", () => {
	async function seedStaff(t: ReturnType<typeof convexTest>, restaurantId: Id<"restaurants">) {
		await t.run(async (ctx) => {
			const restaurant = (await ctx.db.get(restaurantId))!;
			await ctx.db.insert("restaurantMembers", {
				restaurantId,
				organizationId: restaurant.organizationId,
				userId: "staff1",
				role: "manager",
				isActive: true,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		});
		return t.withIdentity({ subject: "staff1" });
	}

	it("records creation once, and not again on an idempotent replay", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedRestaurant(t);
		const startsAt = Date.now() + 3 * 24 * 60 * 60 * 1000;

		const args = {
			restaurantId,
			partySize: 2,
			startsAt,
			contact: { name: "Ada", phone: "+525512345678" },
			source: "whatsapp" as const,
			idempotencyKey: "bot-key-1",
		};
		const [firstId] = await t.mutation(internal.reservations.internalCreate, args);
		const [secondId] = await t.mutation(internal.reservations.internalCreate, args);

		expect(secondId).toBe(firstId);
		const events = await eventsFor(t, AUDIT_EVENT.RESERVATION_CREATED);
		// The replay returns the existing row before reaching the insert, so it
		// must not produce a second creation event.
		expect(events).toHaveLength(1);
		expect(events[0].userId).toBe(AUDIT_SYSTEM_USER_ID);
		expect(events[0].payload).toMatchObject({ source: "whatsapp", partySize: 2 });
	});

	it("records confirm, cancel and no-show with the right actor on each", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, tableId } = await seedRestaurant(t);
		const staff = await seedStaff(t, restaurantId);
		const startsAt = Date.now() + 3 * 24 * 60 * 60 * 1000;

		const [reservationId] = await t.mutation(internal.reservations.internalCreate, {
			restaurantId,
			partySize: 2,
			startsAt,
			contact: { name: "Ada", phone: "+525512345678" },
			source: "ui" as const,
		});

		await staff.mutation(api.reservations.confirm, {
			reservationId: reservationId!,
			tableIds: [tableId],
		});
		const confirmed = await eventsFor(t, AUDIT_EVENT.RESERVATION_CONFIRMED);
		expect(confirmed).toHaveLength(1);
		expect(confirmed[0].userId).toBe("staff1");
		expect(confirmed[0].payload).toMatchObject({ fromStatus: RESERVATION_STATUS.PENDING });

		await staff.mutation(api.reservations.cancel, {
			reservationId: reservationId!,
			reason: "guest called",
		});
		const cancelled = await eventsFor(t, AUDIT_EVENT.RESERVATION_CANCELLED);
		expect(cancelled).toHaveLength(1);
		expect(cancelled[0].payload).toMatchObject({
			fromStatus: RESERVATION_STATUS.CONFIRMED,
			reason: "guest called",
		});
	});

	it("records a swept no-show as the system, with the grace it applied", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedRestaurant(t);

		let reservationId: Id<"reservations">;
		await t.run(async (ctx) => {
			const startsAt = Date.now() - 2 * 60 * 60 * 1000;
			reservationId = await ctx.db.insert("reservations", {
				restaurantId,
				partySize: 2,
				startsAt,
				endsAt: startsAt + 90 * 60 * 1000,
				tableIds: [],
				status: RESERVATION_STATUS.CONFIRMED,
				source: "ui",
				contact: { name: "Ada", phone: "+525512345678" },
				createdAt: startsAt,
				updatedAt: startsAt,
			});
		});

		await t.mutation(internal.reservations.sweepNoShows, {});

		const events = await eventsFor(t, AUDIT_EVENT.RESERVATION_NO_SHOW);
		expect(events).toHaveLength(1);
		expect(events[0].aggregateId).toBe(reservationId!);
		expect(events[0].userId).toBe(AUDIT_SYSTEM_USER_ID);
		expect(events[0].payload).toMatchObject({
			fromStatus: RESERVATION_STATUS.CONFIRMED,
			graceMinutes: 15,
		});
	});
});
