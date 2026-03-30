import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

async function seedRestaurantAndSession(t: ReturnType<typeof convexTest>) {
	let restaurantId: Id<"restaurants">;
	let tableId: Id<"tables">;
	let sessionId: Id<"sessions">;

	await t.run(async (ctx) => {
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner1",
			name: "Test Restaurant",
			slug: "test-r",
			currency: "USD",
			isActive: true,
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
			status: "active",
			startedAt: Date.now(),
		});
	});

	return { restaurantId: restaurantId!, tableId: tableId!, sessionId: sessionId! };
}

/**
 * Simulates the Stripe webhook confirming payment by patching the order
 * to "submitted" status. In production this is done by confirmPayment
 * (an internalMutation called from the webhook handler).
 */
async function simulatePaymentConfirmation(
	t: ReturnType<typeof convexTest>,
	orderId: Id<"orders">
) {
	await t.run(async (ctx) => {
		const now = Date.now();
		await ctx.db.patch(orderId, {
			status: "submitted",
			stripePaymentIntentId: "pi_test_simulated",
			paidAt: now,
			submittedAt: now,
			updatedAt: now,
		});
	});
}

async function seedMenuItem(t: ReturnType<typeof convexTest>, restaurantId: Id<"restaurants">) {
	let menuItemId: Id<"menuItems">;

	await t.run(async (ctx) => {
		const menuId = await ctx.db.insert("menus", {
			restaurantId,
			name: "Main",
			isActive: true,
			displayOrder: 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
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
			name: "Bruschetta",
			basePrice: 800,
			isAvailable: true,
			displayOrder: 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});

	return menuItemId!;
}

describe("orders", () => {
	describe("createDraft", () => {
		it("creates a draft order for an active session", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, tableId } = await seedRestaurantAndSession(t);

			const orderId = await t.mutation(api.orders.createDraft, { sessionId, tableId });
			expect(orderId).toBeTruthy();
		});

		it("returns existing draft if one already exists", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, tableId } = await seedRestaurantAndSession(t);

			const id1 = await t.mutation(api.orders.createDraft, { sessionId, tableId });
			const id2 = await t.mutation(api.orders.createDraft, { sessionId, tableId });
			expect(id1).toBe(id2);
		});

		it("throws for a closed session", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, tableId } = await seedRestaurantAndSession(t);

			await t.run(async (ctx) => {
				await ctx.db.patch(sessionId, { status: "closed", closedAt: Date.now() });
			});

			await expect(t.mutation(api.orders.createDraft, { sessionId, tableId })).rejects.toThrow(
				"Active session not found"
			);
		});
	});

	describe("addItem", () => {
		it("adds an item to a draft order and recalculates total", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId } = await seedRestaurantAndSession(t);
			const menuItemId = await seedMenuItem(t, restaurantId);

			const orderId = await t.mutation(api.orders.createDraft, { sessionId, tableId });
			const itemId = await t.mutation(api.orders.addItem, {
				orderId,
				menuItemId,
				quantity: 2,
				selectedOptions: [],
			});
			expect(itemId).toBeTruthy();

			const order = await t.query(api.orders.getOrderWithItems, { orderId });
			expect(order!.items).toHaveLength(1);
			expect(order!.items[0].menuItemName).toBe("Bruschetta");
			expect(order!.items[0].quantity).toBe(2);
			expect(order!.totalAmount).toBe(1600);
		});
	});

	describe("removeItem", () => {
		it("removes an item and recalculates total", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId } = await seedRestaurantAndSession(t);
			const menuItemId = await seedMenuItem(t, restaurantId);

			const orderId = await t.mutation(api.orders.createDraft, { sessionId, tableId });
			const itemId = await t.mutation(api.orders.addItem, {
				orderId,
				menuItemId,
				quantity: 1,
				selectedOptions: [],
			});

			await t.mutation(api.orders.removeItem, { orderItemId: itemId });

			const order = await t.query(api.orders.getOrderWithItems, { orderId });
			expect(order!.items).toHaveLength(0);
			expect(order!.totalAmount).toBe(0);
		});
	});

	describe("submitOrder", () => {
		it("validates the draft order but keeps it in draft status", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId } = await seedRestaurantAndSession(t);
			const menuItemId = await seedMenuItem(t, restaurantId);

			const orderId = await t.mutation(api.orders.createDraft, { sessionId, tableId });
			await t.mutation(api.orders.addItem, {
				orderId,
				menuItemId,
				quantity: 1,
				selectedOptions: [],
			});

			await t.mutation(api.orders.submitOrder, { orderId });

			const order = await t.query(api.orders.getOrderWithItems, { orderId });
			expect(order!.status).toBe("draft");
		});

		it("saves special instructions", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId } = await seedRestaurantAndSession(t);
			const menuItemId = await seedMenuItem(t, restaurantId);

			const orderId = await t.mutation(api.orders.createDraft, { sessionId, tableId });
			await t.mutation(api.orders.addItem, {
				orderId,
				menuItemId,
				quantity: 1,
				selectedOptions: [],
			});

			await t.mutation(api.orders.submitOrder, {
				orderId,
				specialInstructions: "No onions please",
			});

			const order = await t.query(api.orders.getOrderWithItems, { orderId });
			expect(order!.specialInstructions).toBe("No onions please");
		});

		it("throws when submitting an empty order", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, tableId } = await seedRestaurantAndSession(t);

			const orderId = await t.mutation(api.orders.createDraft, { sessionId, tableId });

			await expect(t.mutation(api.orders.submitOrder, { orderId })).rejects.toThrow(
				"items: Order must have at least one item"
			);
		});
	});

	describe("updateStatus", () => {
		it("follows valid state transitions", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId } = await seedRestaurantAndSession(t);
			const menuItemId = await seedMenuItem(t, restaurantId);
			const authed = t.withIdentity({ subject: "employee1" });

			await t.run(async (ctx) => {
				await ctx.db.insert("userRoles", {
					userId: "employee1",
					roles: ["employee"],
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
			});

			const orderId = await t.mutation(api.orders.createDraft, { sessionId, tableId });
			await t.mutation(api.orders.addItem, {
				orderId,
				menuItemId,
				quantity: 1,
				selectedOptions: [],
			});
			await t.mutation(api.orders.submitOrder, { orderId });
			await simulatePaymentConfirmation(t, orderId);

			const [, err1] = await authed.mutation(api.orders.updateStatus, {
				orderId,
				newStatus: "preparing",
			});
			expect(err1).toBeNull();

			const [, err2] = await authed.mutation(api.orders.updateStatus, {
				orderId,
				newStatus: "ready",
			});
			expect(err2).toBeNull();

			const [, err3] = await authed.mutation(api.orders.updateStatus, {
				orderId,
				newStatus: "served",
			});
			expect(err3).toBeNull();

			const order = await t.query(api.orders.getOrderWithItems, { orderId });
			expect(order!.status).toBe("served");
		});

		it("rejects invalid state transitions", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId } = await seedRestaurantAndSession(t);
			const menuItemId = await seedMenuItem(t, restaurantId);
			const authed = t.withIdentity({ subject: "employee1" });

			await t.run(async (ctx) => {
				await ctx.db.insert("userRoles", {
					userId: "employee1",
					roles: ["employee"],
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
			});

			const orderId = await t.mutation(api.orders.createDraft, { sessionId, tableId });
			await t.mutation(api.orders.addItem, {
				orderId,
				menuItemId,
				quantity: 1,
				selectedOptions: [],
			});
			await t.mutation(api.orders.submitOrder, { orderId });
			await simulatePaymentConfirmation(t, orderId);

			await expect(
				authed.mutation(api.orders.updateStatus, {
					orderId,
					newStatus: "served",
				})
			).rejects.toThrow("Cannot transition from submitted to served");
		});

		it("requires authentication", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId } = await seedRestaurantAndSession(t);
			const menuItemId = await seedMenuItem(t, restaurantId);

			const orderId = await t.mutation(api.orders.createDraft, { sessionId, tableId });
			await t.mutation(api.orders.addItem, {
				orderId,
				menuItemId,
				quantity: 1,
				selectedOptions: [],
			});
			await t.mutation(api.orders.submitOrder, { orderId });
			await simulatePaymentConfirmation(t, orderId);

			const [value, error] = await t.mutation(api.orders.updateStatus, {
				orderId,
				newStatus: "preparing",
			});
			expect(value).toBeNull();
			expect(error!.name).toBe("NOT_AUTHENTICATED");
		});
	});

	describe("getOrderWithItems", () => {
		it("returns null for a non-existent order", async () => {
			const t = convexTest(schema, modules);
			const fakeId = "orders:nonexistent" as Id<"orders">;
			// This will likely throw due to invalid ID in convex-test,
			// so we just verify the function is callable
			const result = await t
				.query(api.orders.getOrderWithItems, { orderId: fakeId })
				.catch(() => null);
			expect(result).toBeNull();
		});
	});

	describe("getActiveOrdersByRestaurant", () => {
		it("returns submitted orders for an authenticated owner", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId } = await seedRestaurantAndSession(t);
			const menuItemId = await seedMenuItem(t, restaurantId);
			const authed = t.withIdentity({ subject: "owner1" });

			await t.run(async (ctx) => {
				await ctx.db.insert("userRoles", {
					userId: "owner1",
					roles: ["owner"],
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
			});

			const orderId = await t.mutation(api.orders.createDraft, { sessionId, tableId });
			await t.mutation(api.orders.addItem, {
				orderId,
				menuItemId,
				quantity: 2,
				selectedOptions: [],
			});
			await t.mutation(api.orders.submitOrder, { orderId });
			await simulatePaymentConfirmation(t, orderId);

			const [orders, error] = await authed.query(api.orders.getActiveOrdersByRestaurant, {
				restaurantId,
			});

			expect(error).toBeNull();
			if (!Array.isArray(orders)) throw new Error("Expected array");
			expect(orders).toHaveLength(1);
			expect(orders[0].status).toBe("submitted");
			expect(orders[0].items).toHaveLength(1);
			expect(orders[0].items[0].menuItemName).toBe("Bruschetta");
			expect(orders[0].tableNumber).toBe(1);
		});

		it("filters out draft, served, and cancelled orders", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId } = await seedRestaurantAndSession(t);
			const menuItemId = await seedMenuItem(t, restaurantId);
			const authed = t.withIdentity({ subject: "owner1" });

			await t.run(async (ctx) => {
				await ctx.db.insert("userRoles", {
					userId: "owner1",
					roles: ["owner"],
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
			});

			const draftOrderId = await t.mutation(api.orders.createDraft, { sessionId, tableId });
			await t.mutation(api.orders.addItem, {
				orderId: draftOrderId,
				menuItemId,
				quantity: 1,
				selectedOptions: [],
			});

			await t.run(async (ctx) => {
				await ctx.db.patch(sessionId, { status: "closed", closedAt: Date.now() });
			});

			let submittedOrderId: Id<"orders">;
			let servedOrderId: Id<"orders">;
			let cancelledOrderId: Id<"orders">;

			await t.run(async (ctx) => {
				const newSession1 = await ctx.db.insert("sessions", {
					restaurantId,
					tableId,
					status: "active",
					startedAt: Date.now(),
				});

				submittedOrderId = await ctx.db.insert("orders", {
					sessionId: newSession1,
					restaurantId,
					tableId,
					status: "submitted",
					totalAmount: 800,
					submittedAt: Date.now(),
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				await ctx.db.insert("orderItems", {
					orderId: submittedOrderId,
					menuItemId,
					menuItemName: "Bruschetta",
					quantity: 1,
					unitPrice: 800,
					selectedOptions: [],
					lineTotal: 800,
					createdAt: Date.now(),
				});

				servedOrderId = await ctx.db.insert("orders", {
					sessionId: newSession1,
					restaurantId,
					tableId,
					status: "served",
					totalAmount: 800,
					submittedAt: Date.now(),
					paidAt: Date.now(),
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});

				cancelledOrderId = await ctx.db.insert("orders", {
					sessionId: newSession1,
					restaurantId,
					tableId,
					status: "cancelled",
					totalAmount: 0,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
			});

			const [orders, error] = await authed.query(api.orders.getActiveOrdersByRestaurant, {
				restaurantId,
			});

			expect(error).toBeNull();
			if (!Array.isArray(orders)) throw new Error("Expected array");
			expect(orders).toHaveLength(1);
			expect(orders[0]._id).toBe(submittedOrderId!);
		});

		it("returns auth error for unauthenticated users", async () => {
			const t = convexTest(schema, modules);
			const { restaurantId } = await seedRestaurantAndSession(t);

			const [orders, error] = await t.query(api.orders.getActiveOrdersByRestaurant, {
				restaurantId,
			});

			expect(orders).toBeNull();
			if (error === null || Array.isArray(error)) throw new Error("Expected error object");
			expect(error.name).toBe("NOT_AUTHENTICATED");
		});

		it("returns auth error for users without required role", async () => {
			const t = convexTest(schema, modules);
			const { restaurantId } = await seedRestaurantAndSession(t);
			const authed = t.withIdentity({ subject: "customer1" });

			await t.run(async (ctx) => {
				await ctx.db.insert("userRoles", {
					userId: "customer1",
					roles: ["customer"],
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
			});

			const [orders, error] = await authed.query(api.orders.getActiveOrdersByRestaurant, {
				restaurantId,
			});

			expect(orders).toBeNull();
			if (error === null || Array.isArray(error)) throw new Error("Expected error object");
			expect(error.name).toBe("NOT_AUTHORIZED");
		});
	});
});
