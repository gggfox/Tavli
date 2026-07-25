/**
 * Tests for the shared tab flow (TAVLI-6): join codes, tab locking, the
 * session-level payment lifecycle, staff close, and the stale-tab sweep.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { STALE_TAB_SWEEP_BATCH_SIZE, STALE_TAB_SWEEP_LOOKBACK_MS } from "../constants";
import { insertMenuForRestaurant } from "../menus";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

async function seedRestaurant(t: ReturnType<typeof convexTest>) {
	let restaurantId: Id<"restaurants">;
	let tableId: Id<"tables">;

	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
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
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		await insertMenuForRestaurant(ctx, {
			restaurantId,
			name: "test-r",
			userId: "owner1",
		});
		tableId = await ctx.db.insert("tables", {
			restaurantId,
			tableNumber: 1,
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

/** Opens a tab as `dinerId`, submits one order, returns the pieces. */
async function seedTabWithOrder(t: ReturnType<typeof convexTest>, dinerId = "diner1") {
	const { restaurantId, tableId } = await seedRestaurant(t);
	const menuItemId = await seedMenuItem(t, restaurantId);
	const authed = t.withIdentity({ subject: dinerId });

	const { sessionId } = await authed.mutation(api.sessions.create, {
		restaurantSlug: "test-r",
	});
	const orderId = await authed.mutation(api.orders.createDraft, { sessionId, tableId });
	await authed.mutation(api.orders.addItem, {
		orderId,
		menuItemId,
		quantity: 2,
		selectedOptions: [],
	});
	await authed.mutation(api.orders.submitOrder, { orderId });

	return { restaurantId, tableId, menuItemId, sessionId, orderId, authed, dinerId };
}

describe("session tabs", () => {
	describe("create / joinByCode", () => {
		it("creates a session with a join code that friends can join", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, authed } = await seedTabWithOrder(t);

			const tab = await authed.query(api.sessions.getTabSummary, { sessionId });
			expect(tab).not.toBeNull();
			expect(tab!.joinCode).toMatch(/^[A-Z2-9]{6}$/);

			const friend = t.withIdentity({ subject: "friend1" });
			const joined = await friend.mutation(api.sessions.joinByCode, {
				restaurantSlug: "test-r",
				joinCode: tab!.joinCode!,
			});
			expect(joined.sessionId).toBe(sessionId);

			// The friend now sees the shared tab.
			const friendTab = await friend.query(api.sessions.getTabSummary, { sessionId });
			expect(friendTab).not.toBeNull();
			expect(friendTab!.memberCount).toBe(2);
		});

		it("rejects an invalid join code", async () => {
			const t = convexTest(schema, modules);
			await seedTabWithOrder(t);

			const friend = t.withIdentity({ subject: "friend1" });
			await expect(
				friend.mutation(api.sessions.joinByCode, {
					restaurantSlug: "test-r",
					joinCode: "XXXXXX",
				})
			).rejects.toThrow();
		});

		it("lets a joined member order onto the shared tab", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, tableId, menuItemId, authed } = await seedTabWithOrder(t);

			const tab = await authed.query(api.sessions.getTabSummary, { sessionId });
			const friend = t.withIdentity({ subject: "friend1" });
			await friend.mutation(api.sessions.joinByCode, {
				restaurantSlug: "test-r",
				joinCode: tab!.joinCode!,
			});

			const friendOrderId = await friend.mutation(api.orders.createDraft, {
				sessionId,
				tableId,
			});
			await friend.mutation(api.orders.addItem, {
				orderId: friendOrderId,
				menuItemId,
				quantity: 1,
				selectedOptions: [],
			});
			await friend.mutation(api.orders.submitOrder, { orderId: friendOrderId });

			const updated = await authed.query(api.sessions.getTabSummary, { sessionId });
			// 2 × 900 from the opener + 1 × 900 from the friend.
			expect(updated!.subtotal).toBe(2700);
			expect(updated!.payableOrderIds).toHaveLength(2);
		});
	});

	describe("tab payment lifecycle", () => {
		it("locks the tab while a payment is in flight and blocks new orders", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId, authed } = await seedTabWithOrder(t);

			await t.mutation(internal.sessions.beginTabPayment, {
				sessionId,
				restaurantId,
				userId: "diner1",
				amount: 1800 + 180,
				currency: "usd",
				gratuityAmount: 180,
			});

			const tab = await authed.query(api.sessions.getTabSummary, { sessionId });
			expect(tab!.lockedForPayment).toBe(true);
			expect(tab!.paymentState).toBe("pending");

			await expect(authed.mutation(api.orders.createDraft, { sessionId, tableId })).rejects.toThrow(
				/ERROR_TAB_LOCKED/
			);
		});

		it("rejects beginTabPayment when the amount does not match the balance", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId } = await seedTabWithOrder(t);

			await expect(
				t.mutation(internal.sessions.beginTabPayment, {
					sessionId,
					restaurantId,
					userId: "diner1",
					amount: 999,
					currency: "usd",
					gratuityAmount: 0,
				})
			).rejects.toThrow(/balance changed/);
		});

		it("confirmTabPayment marks every payable order paid, records the tip, and closes the tab", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, orderId, authed } = await seedTabWithOrder(t);

			const paymentId = await t.mutation(internal.sessions.beginTabPayment, {
				sessionId,
				restaurantId,
				userId: "diner1",
				amount: 1800 + 180,
				currency: "usd",
				gratuityAmount: 180,
			});
			await t.mutation(internal.sessions.markTabPaymentProcessing, {
				sessionId,
				paymentId,
				stripePaymentIntentId: "pi_tab_test",
			});
			await t.mutation(internal.sessions.confirmTabPayment, {
				paymentId,
				stripePaymentIntentId: "pi_tab_test",
				stripeChargeId: "ch_tab_test",
				gratuityAmount: 180,
			});

			await t.run(async (ctx) => {
				const session = await ctx.db.get(sessionId);
				expect(session!.status).toBe("closed");
				expect(session!.paymentState).toBe("paid");
				expect(session!.tipAmount).toBe(180);
				expect(session!.settledBy).toBe("stripe");
				expect(session!.lockedForPaymentAt).toBeUndefined();

				const order = await ctx.db.get(orderId);
				expect(order!.paymentState).toBe("paid");
				expect(order!.paidAt).toBeDefined();

				const payment = await ctx.db.get(paymentId);
				expect(payment!.status).toBe("succeeded");
				expect(payment!.gratuityAmount).toBe(180);
			});

			// Closed session — the diner-facing summary is gone.
			const tab = await authed.query(api.sessions.getTabSummary, { sessionId });
			expect(tab).toBeNull();
		});

		it("failTabPayment unlocks the tab so ordering can resume", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId, authed } = await seedTabWithOrder(t);

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
				stripePaymentIntentId: "pi_tab_failed",
				failureCode: "card_declined",
			});

			const tab = await authed.query(api.sessions.getTabSummary, { sessionId });
			expect(tab!.lockedForPayment).toBe(false);
			expect(tab!.paymentState).toBe("failed");

			// Ordering works again.
			await authed.mutation(api.orders.createDraft, { sessionId, tableId });
		});

		it("cancelTabPayment abandons the in-flight attempt and unlocks", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, authed } = await seedTabWithOrder(t);

			const paymentId = await t.mutation(internal.sessions.beginTabPayment, {
				sessionId,
				restaurantId,
				userId: "diner1",
				amount: 1800,
				currency: "usd",
				gratuityAmount: 0,
			});

			await authed.mutation(api.sessions.cancelTabPayment, { sessionId });

			const tab = await authed.query(api.sessions.getTabSummary, { sessionId });
			expect(tab!.lockedForPayment).toBe(false);
			expect(tab!.paymentState).toBe("unpaid");
			await t.run(async (ctx) => {
				const payment = await ctx.db.get(paymentId);
				expect(payment!.status).toBe("cancelled");
			});
		});
	});

	describe("staff open tabs", () => {
		it("lists open tabs with their unpaid balance and closes one manually", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId } = await seedTabWithOrder(t);

			// Restaurant owners have staff access.
			const staff = t.withIdentity({ subject: "owner1" });
			const [tabs, listError] = await staff.query(api.sessions.getOpenTabsByRestaurant, {
				restaurantId,
			});
			expect(listError).toBeNull();
			expect(tabs).toHaveLength(1);
			expect(tabs![0].unpaidTotal).toBe(1800);
			expect(tabs![0].orderCount).toBe(1);

			const [closedId, closeError] = await staff.mutation(api.sessions.closeTabAsStaff, {
				sessionId,
			});
			expect(closeError).toBeNull();
			expect(closedId).toBe(sessionId);

			await t.run(async (ctx) => {
				const session = await ctx.db.get(sessionId);
				expect(session!.status).toBe("closed");
				expect(session!.settledBy).toBe("staff");
			});
		});

		it("denies the open tabs view to unrelated users", async () => {
			const t = convexTest(schema, modules);
			const { restaurantId } = await seedTabWithOrder(t);

			const stranger = t.withIdentity({ subject: "stranger1" });
			const [tabs, error] = await stranger.query(api.sessions.getOpenTabsByRestaurant, {
				restaurantId,
			});
			expect(tabs).toBeNull();
			expect(error).not.toBeNull();
		});
	});

	describe("sweepStaleOpenTabs", () => {
		it("closes settled stale tabs and flags unpaid ones without charging", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId } = await seedTabWithOrder(t);

			// Age both tabs beyond the 24h cutoff.
			let settledSessionId: Id<"sessions">;
			await t.run(async (ctx) => {
				const old = Date.now() - 26 * 60 * 60 * 1000;
				await ctx.db.patch(sessionId, { startedAt: old });
				settledSessionId = await ctx.db.insert("sessions", {
					restaurantId,
					userId: "diner2",
					status: "active",
					startedAt: old,
				});
			});

			await t.mutation(internal.sessions.sweepStaleOpenTabs, {});

			await t.run(async (ctx) => {
				// No orders → closed quietly.
				const settled = await ctx.db.get(settledSessionId!);
				expect(settled!.status).toBe("closed");

				// Unpaid balance → stays open but flagged for staff.
				const unpaid = await ctx.db.get(sessionId);
				expect(unpaid!.status).toBe("active");
				expect(unpaid!.flaggedStaleAt).toBeDefined();
			});
		});

		it("ignores tabs younger than the 24h cutoff", async () => {
			const t = convexTest(schema, modules);
			const { restaurantId } = await seedRestaurant(t);

			let freshId: Id<"sessions">;
			await t.run(async (ctx) => {
				freshId = await ctx.db.insert("sessions", {
					restaurantId,
					userId: "diner-fresh",
					status: "active",
					startedAt: Date.now() - 2 * 60 * 60 * 1000,
				});
			});

			const result = await t.mutation(internal.sessions.sweepStaleOpenTabs, {});

			expect(result.scanned).toBe(0);
			await t.run(async (ctx) => {
				expect((await ctx.db.get(freshId!))!.status).toBe("active");
			});
		});

		it("does not read tabs older than the lookback window", async () => {
			const t = convexTest(schema, modules);
			const { restaurantId } = await seedRestaurant(t);

			let ancientId: Id<"sessions">;
			await t.run(async (ctx) => {
				ancientId = await ctx.db.insert("sessions", {
					restaurantId,
					userId: "diner-ancient",
					status: "active",
					startedAt: Date.now() - STALE_TAB_SWEEP_LOOKBACK_MS - 60 * 60 * 1000,
				});
			});

			const result = await t.mutation(internal.sessions.sweepStaleOpenTabs, {});

			// Deliberate: an unsettled tab this old was flagged weeks ago and is a
			// staff conversation. The sweep no longer re-reads it every hour.
			expect(result.scanned).toBe(0);
			await t.run(async (ctx) => {
				expect((await ctx.db.get(ancientId!))!.status).toBe("active");
			});
		});

		it("caps the rows it touches per run, newest-first", async () => {
			const t = convexTest(schema, modules);
			const { restaurantId } = await seedRestaurant(t);
			const overflow = 3;
			const base = Date.now() - 26 * 60 * 60 * 1000;

			let newestId: Id<"sessions">;
			await t.run(async (ctx) => {
				for (let i = 0; i < STALE_TAB_SWEEP_BATCH_SIZE + overflow; i++) {
					// i = 0 is the oldest; the last insert is the newest stale tab.
					const id = await ctx.db.insert("sessions", {
						restaurantId,
						userId: `diner-${i}`,
						status: "active",
						startedAt: base - (STALE_TAB_SWEEP_BATCH_SIZE + overflow - i) * 1000,
					});
					newestId = id;
				}
			});

			const result = await t.mutation(internal.sessions.sweepStaleOpenTabs, {});

			expect(result.scanned).toBe(STALE_TAB_SWEEP_BATCH_SIZE);
			// Newest-first: the tab that most recently went stale is always reached,
			// never starved by a backlog of older already-flagged ones.
			await t.run(async (ctx) => {
				expect((await ctx.db.get(newestId!))!.status).toBe("closed");
			});
		});
	});
});
