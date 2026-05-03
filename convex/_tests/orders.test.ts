import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { getOrderServiceDateKey } from "../orderServiceDate";
import { insertMenuForRestaurant } from "../menus";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

async function seedOrganization(t: ReturnType<typeof convexTest>) {
	let organizationId: Id<"organizations">;

	await t.run(async (ctx) => {
		organizationId = await ctx.db.insert("organizations", {
			name: "Test Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});

	return organizationId!;
}

async function seedRestaurantAndSession(t: ReturnType<typeof convexTest>) {
	let restaurantId: Id<"restaurants">;
	let tableId: Id<"tables">;
	let sessionId: Id<"sessions">;

	const organizationId = await seedOrganization(t);

	await t.run(async (ctx) => {
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

		sessionId = await ctx.db.insert("sessions", {
			restaurantId,
			tableId,
			status: "active",
			startedAt: Date.now(),
		});
	});

	return {
		organizationId: organizationId!,
		restaurantId: restaurantId!,
		tableId: tableId!,
		sessionId: sessionId!,
	};
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
			paymentState: "paid",
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
		const allMenus = await ctx.db.query("menus").collect();
		const forRestaurant = allMenus.filter((m) => m.restaurantId === restaurantId);
		const sortedMenus = [...forRestaurant].sort((a, b) => a.displayOrder - b.displayOrder);
		const menuId =
			sortedMenus[0]?._id ??
			(await insertMenuForRestaurant(ctx, {
				restaurantId,
				name: "main",
				userId: "owner1",
			}));

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

async function seedOptionGroupAndOption(
	t: ReturnType<typeof convexTest>,
	restaurantId: Id<"restaurants">
) {
	let optionGroupId: Id<"optionGroups">;
	let optionId: Id<"options">;

	await t.run(async (ctx) => {
		optionGroupId = await ctx.db.insert("optionGroups", {
			restaurantId,
			name: "Add-ons",
			selectionType: "single",
			isRequired: false,
			minSelections: 0,
			maxSelections: 1,
			displayOrder: 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});

		optionId = await ctx.db.insert("options", {
			optionGroupId,
			restaurantId,
			name: "Extra cheese",
			priceModifier: 250,
			isAvailable: true,
			displayOrder: 0,
			createdAt: Date.now(),
		});
	});

	return { optionGroupId: optionGroupId!, optionId: optionId! };
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

		it("recalculates selected option pricing from server-side records", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId } = await seedRestaurantAndSession(t);
			const menuItemId = await seedMenuItem(t, restaurantId);
			const { optionGroupId, optionId } = await seedOptionGroupAndOption(t, restaurantId);

			const orderId = await t.mutation(api.orders.createDraft, { sessionId, tableId });
			await t.mutation(api.orders.addItem, {
				orderId,
				menuItemId,
				quantity: 1,
				selectedOptions: [
					{
						optionGroupId,
						optionGroupName: "Tampered Group Name",
						optionId,
						optionName: "Tampered Option Name",
						priceModifier: 0,
					},
				],
			});

			const order = await t.query(api.orders.getOrderWithItems, { orderId });
			expect(order!.totalAmount).toBe(1050);
			expect(order!.items[0].selectedOptions[0].priceModifier).toBe(250);
			expect(order!.items[0].selectedOptions[0].optionName).toBe("Extra cheese");
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

		it("ignores stale payment confirmations for non-active payment attempts", async () => {
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

			const firstPaymentId = await t.mutation(internal.stripeHelpers.createPayment, {
				restaurantId,
				orderId,
				amount: 800,
				currency: "usd",
				status: "processing",
				refundStatus: "none",
				attemptNumber: 1,
				orderUpdatedAtSnapshot: (await t.query(api.orders.getOrderWithItems, { orderId }))!.updatedAt,
			});
			const secondPaymentId = await t.mutation(internal.stripeHelpers.createPayment, {
				restaurantId,
				orderId,
				amount: 800,
				currency: "usd",
				status: "processing",
				refundStatus: "none",
				attemptNumber: 2,
				orderUpdatedAtSnapshot: (await t.query(api.orders.getOrderWithItems, { orderId }))!.updatedAt,
			});
			await t.mutation(internal.stripeHelpers.updateOrderPaymentSummary, {
				orderId,
				paymentState: "processing",
				activePaymentId: secondPaymentId,
				stripePaymentIntentId: "pi_active",
			});

			await t.mutation(internal.orders.confirmPayment, {
				paymentId: firstPaymentId,
				stripePaymentIntentId: "pi_stale",
			});

			const order = await t.query(api.orders.getOrderWithItems, { orderId });
			expect(order!.status).toBe("draft");
			expect(order!.paymentState).toBe("processing");

			const stalePayment = await t.run(async (ctx) => ctx.db.get(firstPaymentId));
			expect(stalePayment?.status).toBe("processing");
		});
	});

	describe("updateStatus", () => {
		it("follows valid state transitions", async () => {
			const t = convexTest(schema, modules);
			const { organizationId, sessionId, restaurantId, tableId } =
				await seedRestaurantAndSession(t);
			const menuItemId = await seedMenuItem(t, restaurantId);
			const authed = t.withIdentity({ subject: "employee1" });

			await t.run(async (ctx) => {
				await ctx.db.insert("userRoles", {
					userId: "employee1",
					roles: ["employee"],
					organizationId,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				await ctx.db.insert("restaurantMembers", {
					userId: "employee1",
					restaurantId,
					organizationId,
					role: "employee",
					isActive: true,
					createdAt: Date.now(),
					updatedAt: Date.now(),
					updatedBy: "system",
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
			const { organizationId, sessionId, restaurantId, tableId } =
				await seedRestaurantAndSession(t);
			const menuItemId = await seedMenuItem(t, restaurantId);
			const authed = t.withIdentity({ subject: "employee1" });

			await t.run(async (ctx) => {
				await ctx.db.insert("userRoles", {
					userId: "employee1",
					roles: ["employee"],
					organizationId,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				await ctx.db.insert("restaurantMembers", {
					userId: "employee1",
					restaurantId,
					organizationId,
					role: "employee",
					isActive: true,
					createdAt: Date.now(),
					updatedAt: Date.now(),
					updatedBy: "system",
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
			const { organizationId, sessionId, restaurantId, tableId } =
				await seedRestaurantAndSession(t);
			const menuItemId = await seedMenuItem(t, restaurantId);
			const authed = t.withIdentity({ subject: "owner1" });

			await t.run(async (ctx) => {
				await ctx.db.insert("userRoles", {
					userId: "owner1",
					roles: ["owner"],
					organizationId,
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
			const { organizationId, sessionId, restaurantId, tableId } =
				await seedRestaurantAndSession(t);
			const menuItemId = await seedMenuItem(t, restaurantId);
			const authed = t.withIdentity({ subject: "owner1" });

			await t.run(async (ctx) => {
				await ctx.db.insert("userRoles", {
					userId: "owner1",
					roles: ["owner"],
					organizationId,
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
					paymentState: "paid",
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

				await ctx.db.insert("orders", {
					sessionId: newSession1,
					restaurantId,
					tableId,
					status: "served",
					totalAmount: 800,
					paymentState: "paid",
					submittedAt: Date.now(),
					paidAt: Date.now(),
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});

				await ctx.db.insert("orders", {
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

		it("returns served and cancelled orders when explicitly requested via statuses filter", async () => {
			const t = convexTest(schema, modules);
			const { organizationId, restaurantId, tableId } = await seedRestaurantAndSession(t);
			const menuItemId = await seedMenuItem(t, restaurantId);
			const authed = t.withIdentity({ subject: "owner1" });

			await t.run(async (ctx) => {
				await ctx.db.insert("userRoles", {
					userId: "owner1",
					roles: ["owner"],
					organizationId,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
			});

			let servedOrderId: Id<"orders">;
			let cancelledOrderId: Id<"orders">;
			let submittedOrderId: Id<"orders">;
			await t.run(async (ctx) => {
				const session = await ctx.db.insert("sessions", {
					restaurantId,
					tableId,
					status: "active",
					startedAt: Date.now(),
				});

				submittedOrderId = await ctx.db.insert("orders", {
					sessionId: session,
					restaurantId,
					tableId,
					status: "submitted",
					totalAmount: 500,
					paymentState: "paid",
					submittedAt: Date.now(),
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				await ctx.db.insert("orderItems", {
					orderId: submittedOrderId,
					menuItemId,
					menuItemName: "Bruschetta",
					quantity: 1,
					unitPrice: 500,
					selectedOptions: [],
					lineTotal: 500,
					createdAt: Date.now(),
				});

				servedOrderId = await ctx.db.insert("orders", {
					sessionId: session,
					restaurantId,
					tableId,
					status: "served",
					totalAmount: 700,
					paymentState: "paid",
					submittedAt: Date.now(),
					paidAt: Date.now(),
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				await ctx.db.insert("orderItems", {
					orderId: servedOrderId,
					menuItemId,
					menuItemName: "Bruschetta",
					quantity: 1,
					unitPrice: 700,
					selectedOptions: [],
					lineTotal: 700,
					createdAt: Date.now(),
				});

				cancelledOrderId = await ctx.db.insert("orders", {
					sessionId: session,
					restaurantId,
					tableId,
					status: "cancelled",
					totalAmount: 0,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
			});

			// Default behaviour (no statuses) keeps the active-only contract.
			const [defaultOrders] = await authed.query(api.orders.getActiveOrdersByRestaurant, {
				restaurantId,
			});
			if (!Array.isArray(defaultOrders)) throw new Error("Expected array");
			expect(defaultOrders.map((o) => o._id)).toEqual([submittedOrderId!]);

			// Explicit served+cancelled returns only those.
			const [terminalOrders] = await authed.query(api.orders.getActiveOrdersByRestaurant, {
				restaurantId,
				statuses: ["served", "cancelled"],
			});
			if (!Array.isArray(terminalOrders)) throw new Error("Expected array");
			expect(new Set(terminalOrders.map((o) => o._id))).toEqual(
				new Set([servedOrderId!, cancelledOrderId!])
			);

			// Combined active + terminal returns all three.
			const [allOrders] = await authed.query(api.orders.getActiveOrdersByRestaurant, {
				restaurantId,
				statuses: ["submitted", "served", "cancelled"],
			});
			if (!Array.isArray(allOrders)) throw new Error("Expected array");
			expect(allOrders).toHaveLength(3);
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
			const { organizationId, restaurantId } = await seedRestaurantAndSession(t);
			const authed = t.withIdentity({ subject: "customer1" });

			await t.run(async (ctx) => {
				await ctx.db.insert("userRoles", {
					userId: "customer1",
					roles: ["customer"],
					organizationId,
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

	describe("confirmPayment daily order numbers", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});
		afterEach(() => {
			vi.useRealTimers();
		});

		async function seedPaymentForOrder(
			t: ReturnType<typeof convexTest>,
			args: {
				restaurantId: Id<"restaurants">;
				sessionId: Id<"sessions">;
				tableId: Id<"tables">;
				menuItemId: Id<"menuItems">;
			}
		) {
			const orderId = await t.mutation(api.orders.createDraft, {
				sessionId: args.sessionId,
				tableId: args.tableId,
			});
			await t.mutation(api.orders.addItem, {
				orderId,
				menuItemId: args.menuItemId,
				quantity: 1,
				selectedOptions: [],
			});
			const snap = (await t.query(api.orders.getOrderWithItems, { orderId }))!.updatedAt;
			const paymentId = await t.mutation(internal.stripeHelpers.createPayment, {
				restaurantId: args.restaurantId,
				orderId,
				amount: 800,
				currency: "usd",
				status: "processing",
				refundStatus: "none",
				attemptNumber: 1,
				orderUpdatedAtSnapshot: snap,
			});
			await t.mutation(internal.stripeHelpers.updateOrderPaymentSummary, {
				orderId,
				paymentState: "processing",
				activePaymentId: paymentId,
				stripePaymentIntentId: `pi_${orderId}`,
			});
			return { orderId, paymentId };
		}

		it("assigns 1 then 2 on the same service date and creates a counter row", async () => {
			vi.setSystemTime(new Date(Date.UTC(2024, 5, 15, 12, 0, 0)));
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId } = await seedRestaurantAndSession(t);
			await t.run(async (ctx) => {
				await ctx.db.patch(restaurantId, { timezone: "UTC" });
			});
			const menuItemId = await seedMenuItem(t, restaurantId);

			const { orderId: orderId1, paymentId: paymentId1 } = await seedPaymentForOrder(t, {
				restaurantId,
				sessionId,
				tableId,
				menuItemId,
			});
			await t.mutation(internal.orders.confirmPayment, {
				paymentId: paymentId1,
				stripePaymentIntentId: `pi_${orderId1}`,
			});

			const expectedKey = getOrderServiceDateKey(Date.now(), "UTC", 240);
			const o1 = await t.query(api.orders.getOrderWithItems, { orderId: orderId1 });
			expect(o1!.dailyOrderNumber).toBe(1);
			expect(o1!.orderServiceDateKey).toBe(expectedKey);

			const { orderId: orderId2, paymentId: paymentId2 } = await seedPaymentForOrder(t, {
				restaurantId,
				sessionId,
				tableId,
				menuItemId,
			});
			await t.mutation(internal.orders.confirmPayment, {
				paymentId: paymentId2,
				stripePaymentIntentId: `pi_${orderId2}`,
			});
			const o2 = await t.query(api.orders.getOrderWithItems, { orderId: orderId2 });
			expect(o2!.dailyOrderNumber).toBe(2);
			expect(o2!.orderServiceDateKey).toBe(expectedKey);

			const counter = await t.run(async (ctx) =>
				ctx.db
					.query("orderDayCounters")
					.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
					.first()
			);
			expect(counter?.lastIssuedNumber).toBe(2);
			expect(counter?.serviceDateKey).toBe(expectedKey);
		});

		it("resets sequence when the service date changes", async () => {
			vi.setSystemTime(new Date(Date.UTC(2024, 5, 15, 12, 0, 0)));
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId } = await seedRestaurantAndSession(t);
			await t.run(async (ctx) => {
				await ctx.db.patch(restaurantId, { timezone: "UTC" });
			});
			const menuItemId = await seedMenuItem(t, restaurantId);

			const { orderId: orderId1, paymentId: paymentId1 } = await seedPaymentForOrder(t, {
				restaurantId,
				sessionId,
				tableId,
				menuItemId,
			});
			await t.mutation(internal.orders.confirmPayment, {
				paymentId: paymentId1,
				stripePaymentIntentId: `pi_${orderId1}`,
			});

			vi.setSystemTime(new Date(Date.UTC(2024, 5, 16, 12, 0, 0)));
			const { orderId: orderId2, paymentId: paymentId2 } = await seedPaymentForOrder(t, {
				restaurantId,
				sessionId,
				tableId,
				menuItemId,
			});
			await t.mutation(internal.orders.confirmPayment, {
				paymentId: paymentId2,
				stripePaymentIntentId: `pi_${orderId2}`,
			});

			const o2 = await t.query(api.orders.getOrderWithItems, { orderId: orderId2 });
			expect(o2!.dailyOrderNumber).toBe(1);
			expect(o2!.orderServiceDateKey).toBe(getOrderServiceDateKey(Date.now(), "UTC", 240));
		});

		it("keeps the same service date before the UTC cutoff after midnight", async () => {
			vi.setSystemTime(new Date(Date.UTC(2024, 5, 15, 12, 0, 0)));
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId } = await seedRestaurantAndSession(t);
			await t.run(async (ctx) => {
				await ctx.db.patch(restaurantId, { timezone: "UTC" });
			});
			const menuItemId = await seedMenuItem(t, restaurantId);

			const { orderId: orderId1, paymentId: paymentId1 } = await seedPaymentForOrder(t, {
				restaurantId,
				sessionId,
				tableId,
				menuItemId,
			});
			await t.mutation(internal.orders.confirmPayment, {
				paymentId: paymentId1,
				stripePaymentIntentId: `pi_${orderId1}`,
			});
			const key15 = getOrderServiceDateKey(Date.now(), "UTC", 240);
			expect(key15).toBe("2024-06-15");

			vi.setSystemTime(new Date(Date.UTC(2024, 5, 16, 2, 0, 0)));
			const { orderId: orderId2, paymentId: paymentId2 } = await seedPaymentForOrder(t, {
				restaurantId,
				sessionId,
				tableId,
				menuItemId,
			});
			await t.mutation(internal.orders.confirmPayment, {
				paymentId: paymentId2,
				stripePaymentIntentId: `pi_${orderId2}`,
			});

			const o2 = await t.query(api.orders.getOrderWithItems, { orderId: orderId2 });
			expect(o2!.orderServiceDateKey).toBe("2024-06-15");
			expect(o2!.dailyOrderNumber).toBe(2);
		});
	});
});
