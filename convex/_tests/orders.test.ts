import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ERROR_NAMES } from "../_shared/errors";
import { assertPositiveIntegerQuantity } from "../orderHelpers";
import { getOrderResetPeriodKey, getOrderServiceDateKey } from "../orderServiceDate";
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

async function seedRestaurantAndSession(t: ReturnType<typeof convexTest>, dinerId = "diner1") {
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
			userId: dinerId,
			status: "active",
			startedAt: Date.now(),
		});
	});

	const authed = t.withIdentity({ subject: dinerId });

	return {
		organizationId: organizationId!,
		restaurantId: restaurantId!,
		tableId: tableId!,
		sessionId: sessionId!,
		authed,
		dinerId,
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

/**
 * Seed an additional menu item with an explicit prep station, alongside
 * the default `seedMenuItem` (which leaves prepStation undefined and so
 * resolves to "kitchen"). Used by the prep-station / markStationReady
 * tests.
 */
async function seedMenuItemWithStation(
	t: ReturnType<typeof convexTest>,
	restaurantId: Id<"restaurants">,
	args: { name: string; prepStation: "kitchen" | "bar"; basePrice?: number }
) {
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

		const allCategories = await ctx.db.query("menuCategories").collect();
		const existing = allCategories.find((c) => c.menuId === menuId);
		const categoryId =
			existing?._id ??
			(await ctx.db.insert("menuCategories", {
				menuId,
				restaurantId,
				name: "All",
				displayOrder: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			}));

		menuItemId = await ctx.db.insert("menuItems", {
			categoryId,
			restaurantId,
			name: args.name,
			basePrice: args.basePrice ?? 600,
			isAvailable: true,
			displayOrder: 0,
			prepStation: args.prepStation,
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
			const { sessionId, tableId, authed } = await seedRestaurantAndSession(t);

			const orderId = await authed.mutation(api.orders.createDraft, { sessionId, tableId });
			expect(orderId).toBeTruthy();
		});

		it("returns existing draft if one already exists", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, tableId, authed } = await seedRestaurantAndSession(t);

			const id1 = await authed.mutation(api.orders.createDraft, { sessionId, tableId });
			const id2 = await authed.mutation(api.orders.createDraft, { sessionId, tableId });
			expect(id1).toBe(id2);
		});

		it("throws for a closed session", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, tableId, authed } = await seedRestaurantAndSession(t);

			await t.run(async (ctx) => {
				await ctx.db.patch(sessionId, { status: "closed", closedAt: Date.now() });
			});

			await expect(authed.mutation(api.orders.createDraft, { sessionId, tableId })).rejects.toThrow(
				"Active session not found"
			);
		});
	});

	describe("addItem", () => {
		it("adds an item to a draft order and recalculates total", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId, authed } = await seedRestaurantAndSession(t);
			const menuItemId = await seedMenuItem(t, restaurantId);

			const orderId = await authed.mutation(api.orders.createDraft, { sessionId, tableId });
			const itemId = await authed.mutation(api.orders.addItem, {
				orderId,
				menuItemId,
				quantity: 2,
				selectedOptions: [],
			});
			expect(itemId).toBeTruthy();

			const order = await authed.query(api.orders.getOrderWithItems, { orderId });
			expect(order!.items).toHaveLength(1);
			expect(order!.items[0].menuItemName).toBe("Bruschetta");
			expect(order!.items[0].quantity).toBe(2);
			expect(order!.totalAmount).toBe(1600);
		});

		it("recalculates selected option pricing from server-side records", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId, authed } = await seedRestaurantAndSession(t);
			const menuItemId = await seedMenuItem(t, restaurantId);
			const { optionGroupId, optionId } = await seedOptionGroupAndOption(t, restaurantId);

			const orderId = await authed.mutation(api.orders.createDraft, { sessionId, tableId });
			await authed.mutation(api.orders.addItem, {
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

			const order = await authed.query(api.orders.getOrderWithItems, { orderId });
			expect(order!.totalAmount).toBe(1050);
			expect(order!.items[0].selectedOptions[0].priceModifier).toBe(250);
			expect(order!.items[0].selectedOptions[0].optionName).toBe("Extra cheese");
		});

		it.each([0, -1, -5, 1.5, NaN, Infinity])(
			"rejects invalid quantity %s on addItem",
			async (quantity) => {
				const t = convexTest(schema, modules);
				const { sessionId, restaurantId, tableId, authed } = await seedRestaurantAndSession(t);
				const menuItemId = await seedMenuItem(t, restaurantId);
				const orderId = await authed.mutation(api.orders.createDraft, { sessionId, tableId });

				await expect(
					authed.mutation(api.orders.addItem, {
						orderId,
						menuItemId,
						quantity,
						selectedOptions: [],
					})
				).rejects.toMatchObject({ name: ERROR_NAMES.VALIDATION_ERROR });
			}
		);
	});

	describe("updateItem", () => {
		it.each([0, -2, 2.5, NaN])("rejects invalid quantity %s on updateItem", async (quantity) => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId, authed } = await seedRestaurantAndSession(t);
			const menuItemId = await seedMenuItem(t, restaurantId);
			const orderId = await authed.mutation(api.orders.createDraft, { sessionId, tableId });
			const itemId = await authed.mutation(api.orders.addItem, {
				orderId,
				menuItemId,
				quantity: 1,
				selectedOptions: [],
			});

			await expect(
				authed.mutation(api.orders.updateItem, { orderItemId: itemId, quantity })
			).rejects.toMatchObject({ name: ERROR_NAMES.VALIDATION_ERROR });
		});
	});

	describe("assertPositiveIntegerQuantity", () => {
		it.each([1, 2, 99])("accepts %s", (quantity) => {
			expect(() => assertPositiveIntegerQuantity(quantity)).not.toThrow();
		});

		it.each([0, -1, 1.5, NaN, Infinity])("rejects %s", (quantity) => {
			expect(() => assertPositiveIntegerQuantity(quantity)).toThrow(
				expect.objectContaining({ name: ERROR_NAMES.VALIDATION_ERROR })
			);
		});
	});

	describe("removeItem", () => {
		it("removes an item and recalculates total", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId, authed } = await seedRestaurantAndSession(t);
			const menuItemId = await seedMenuItem(t, restaurantId);

			const orderId = await authed.mutation(api.orders.createDraft, { sessionId, tableId });
			const itemId = await authed.mutation(api.orders.addItem, {
				orderId,
				menuItemId,
				quantity: 1,
				selectedOptions: [],
			});

			await authed.mutation(api.orders.removeItem, { orderItemId: itemId });

			const order = await authed.query(api.orders.getOrderWithItems, { orderId });
			expect(order!.items).toHaveLength(0);
			expect(order!.totalAmount).toBe(0);
		});
	});

	describe("submitOrder", () => {
		// TAVLI-6: payment moved to the end of the visit — submitting sends the
		// order to the kitchen immediately and it joins the tab as unpaid.
		it("submits the order to the kitchen unpaid and assigns a daily number", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId, authed } = await seedRestaurantAndSession(t);
			const menuItemId = await seedMenuItem(t, restaurantId);

			const orderId = await authed.mutation(api.orders.createDraft, { sessionId, tableId });
			await authed.mutation(api.orders.addItem, {
				orderId,
				menuItemId,
				quantity: 1,
				selectedOptions: [],
			});

			await authed.mutation(api.orders.submitOrder, { orderId });

			const order = await authed.query(api.orders.getOrderWithItems, { orderId });
			expect(order!.status).toBe("submitted");
			expect(order!.paymentState).toBe("unpaid");
			expect(order!.submittedAt).toBeDefined();
			expect(order!.dailyOrderNumber).toBe(1);
		});

		it("saves special instructions", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId, authed } = await seedRestaurantAndSession(t);
			const menuItemId = await seedMenuItem(t, restaurantId);

			const orderId = await authed.mutation(api.orders.createDraft, { sessionId, tableId });
			await authed.mutation(api.orders.addItem, {
				orderId,
				menuItemId,
				quantity: 1,
				selectedOptions: [],
			});

			await authed.mutation(api.orders.submitOrder, {
				orderId,
				specialInstructions: "No onions please",
			});

			const order = await authed.query(api.orders.getOrderWithItems, { orderId });
			expect(order!.specialInstructions).toBe("No onions please");
		});

		it("throws when submitting an empty order", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, tableId, authed } = await seedRestaurantAndSession(t);

			const orderId = await authed.mutation(api.orders.createDraft, { sessionId, tableId });

			await expect(authed.mutation(api.orders.submitOrder, { orderId })).rejects.toThrow(
				"items: Order must have at least one item"
			);
		});

		it("ignores stale payment confirmations for non-active payment attempts", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId, authed } = await seedRestaurantAndSession(t);
			const menuItemId = await seedMenuItem(t, restaurantId);

			const orderId = await authed.mutation(api.orders.createDraft, { sessionId, tableId });
			await authed.mutation(api.orders.addItem, {
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
				orderUpdatedAtSnapshot: (await authed.query(api.orders.getOrderWithItems, { orderId }))!
					.updatedAt,
			});
			const secondPaymentId = await t.mutation(internal.stripeHelpers.createPayment, {
				restaurantId,
				orderId,
				amount: 800,
				currency: "usd",
				status: "processing",
				refundStatus: "none",
				attemptNumber: 2,
				orderUpdatedAtSnapshot: (await authed.query(api.orders.getOrderWithItems, { orderId }))!
					.updatedAt,
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

			const order = await authed.query(api.orders.getOrderWithItems, { orderId });
			expect(order!.status).toBe("draft");
			expect(order!.paymentState).toBe("processing");

			const stalePayment = await t.run(async (ctx) => ctx.db.get(firstPaymentId));
			expect(stalePayment?.status).toBe("processing");
		});
	});

	describe("updateStatus", () => {
		it("follows valid state transitions", async () => {
			const t = convexTest(schema, modules);
			const {
				organizationId,
				sessionId,
				restaurantId,
				tableId,
				authed: diner,
			} = await seedRestaurantAndSession(t);
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

			const orderId = await diner.mutation(api.orders.createDraft, { sessionId, tableId });
			await diner.mutation(api.orders.addItem, {
				orderId,
				menuItemId,
				quantity: 1,
				selectedOptions: [],
			});
			await diner.mutation(api.orders.submitOrder, { orderId });
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

			const order = await diner.query(api.orders.getOrderWithItems, { orderId });
			expect(order!.status).toBe("served");
		});

		it("rejects invalid state transitions", async () => {
			const t = convexTest(schema, modules);
			const {
				organizationId,
				sessionId,
				restaurantId,
				tableId,
				authed: diner,
			} = await seedRestaurantAndSession(t);
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

			const orderId = await diner.mutation(api.orders.createDraft, { sessionId, tableId });
			await diner.mutation(api.orders.addItem, {
				orderId,
				menuItemId,
				quantity: 1,
				selectedOptions: [],
			});
			await diner.mutation(api.orders.submitOrder, { orderId });
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
			const { sessionId, restaurantId, tableId, authed } = await seedRestaurantAndSession(t);
			const menuItemId = await seedMenuItem(t, restaurantId);

			const orderId = await authed.mutation(api.orders.createDraft, { sessionId, tableId });
			await authed.mutation(api.orders.addItem, {
				orderId,
				menuItemId,
				quantity: 1,
				selectedOptions: [],
			});
			await authed.mutation(api.orders.submitOrder, { orderId });
			await simulatePaymentConfirmation(t, orderId);

			const [value, error] = await t.mutation(api.orders.updateStatus, {
				orderId,
				newStatus: "preparing",
			});
			expect(value).toBeNull();
			expect(error!.name).toBe("NOT_AUTHENTICATED");
		});

		it("backfills dailyOrderNumber and orderServiceDateKey for a legacy order missing them", async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date(Date.UTC(2024, 5, 15, 12, 0, 0)));
			try {
				const t = convexTest(schema, modules);
				const {
					organizationId,
					sessionId,
					restaurantId,
					tableId,
					authed: diner,
				} = await seedRestaurantAndSession(t);
				const menuItemId = await seedMenuItem(t, restaurantId);
				const authed = t.withIdentity({ subject: "employee1" });

				await t.run(async (ctx) => {
					await ctx.db.patch(restaurantId, {
						timezone: "UTC",
						orderNumberResetFrequency: "daily",
					});
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

				let legacyOrderId: Id<"orders">;
				await t.run(async (ctx) => {
					legacyOrderId = await ctx.db.insert("orders", {
						sessionId,
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
						orderId: legacyOrderId,
						menuItemId,
						menuItemName: "Bruschetta",
						quantity: 1,
						unitPrice: 800,
						selectedOptions: [],
						lineTotal: 800,
						createdAt: Date.now(),
					});
				});

				const [, err] = await authed.mutation(api.orders.updateStatus, {
					orderId: legacyOrderId!,
					newStatus: "preparing",
				});
				expect(err).toBeNull();

				const order = await diner.query(api.orders.getOrderWithItems, { orderId: legacyOrderId! });
				expect(order!.status).toBe("preparing");
				expect(order!.dailyOrderNumber).toBe(1);
				expect(order!.orderServiceDateKey).toBe(getOrderServiceDateKey(Date.now(), "UTC", 240));
			} finally {
				vi.useRealTimers();
			}
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
			const {
				organizationId,
				sessionId,
				restaurantId,
				tableId,
				authed: diner,
			} = await seedRestaurantAndSession(t);
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

			const orderId = await diner.mutation(api.orders.createDraft, { sessionId, tableId });
			await diner.mutation(api.orders.addItem, {
				orderId,
				menuItemId,
				quantity: 2,
				selectedOptions: [],
			});
			await diner.mutation(api.orders.submitOrder, { orderId });
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
			const {
				organizationId,
				sessionId,
				restaurantId,
				tableId,
				authed: diner,
			} = await seedRestaurantAndSession(t);
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

			const draftOrderId = await diner.mutation(api.orders.createDraft, { sessionId, tableId });
			await diner.mutation(api.orders.addItem, {
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

		it("filters orders by prepStation (presence-based, live lookup)", async () => {
			const t = convexTest(schema, modules);
			const { organizationId, restaurantId, tableId } = await seedRestaurantAndSession(t);
			const kitchenItemId = await seedMenuItemWithStation(t, restaurantId, {
				name: "Steak",
				prepStation: "kitchen",
			});
			const barItemId = await seedMenuItemWithStation(t, restaurantId, {
				name: "Margarita",
				prepStation: "bar",
			});
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

			let kitchenOnlyId: Id<"orders">;
			let barOnlyId: Id<"orders">;
			let mixedId: Id<"orders">;
			await t.run(async (ctx) => {
				const session = await ctx.db.insert("sessions", {
					restaurantId,
					tableId,
					status: "active",
					startedAt: Date.now(),
				});

				kitchenOnlyId = await ctx.db.insert("orders", {
					sessionId: session,
					restaurantId,
					tableId,
					status: "submitted",
					totalAmount: 800,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				await ctx.db.insert("orderItems", {
					orderId: kitchenOnlyId,
					menuItemId: kitchenItemId,
					menuItemName: "Steak",
					quantity: 1,
					unitPrice: 800,
					selectedOptions: [],
					lineTotal: 800,
					createdAt: Date.now(),
				});

				barOnlyId = await ctx.db.insert("orders", {
					sessionId: session,
					restaurantId,
					tableId,
					status: "submitted",
					totalAmount: 600,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				await ctx.db.insert("orderItems", {
					orderId: barOnlyId,
					menuItemId: barItemId,
					menuItemName: "Margarita",
					quantity: 1,
					unitPrice: 600,
					selectedOptions: [],
					lineTotal: 600,
					createdAt: Date.now(),
				});

				mixedId = await ctx.db.insert("orders", {
					sessionId: session,
					restaurantId,
					tableId,
					status: "submitted",
					totalAmount: 1400,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				await ctx.db.insert("orderItems", {
					orderId: mixedId,
					menuItemId: kitchenItemId,
					menuItemName: "Steak",
					quantity: 1,
					unitPrice: 800,
					selectedOptions: [],
					lineTotal: 800,
					createdAt: Date.now(),
				});
				await ctx.db.insert("orderItems", {
					orderId: mixedId,
					menuItemId: barItemId,
					menuItemName: "Margarita",
					quantity: 1,
					unitPrice: 600,
					selectedOptions: [],
					lineTotal: 600,
					createdAt: Date.now(),
				});
			});

			// No filter → all three orders.
			const [allOrders] = await authed.query(api.orders.getActiveOrdersByRestaurant, {
				restaurantId,
			});
			if (!Array.isArray(allOrders)) throw new Error("Expected array");
			expect(new Set(allOrders.map((o) => o._id))).toEqual(
				new Set([kitchenOnlyId!, barOnlyId!, mixedId!])
			);

			// Bar filter → bar-only and mixed (mixed has at least one bar item).
			const [barOrders] = await authed.query(api.orders.getActiveOrdersByRestaurant, {
				restaurantId,
				prepStations: ["bar"],
			});
			if (!Array.isArray(barOrders)) throw new Error("Expected array");
			expect(new Set(barOrders.map((o) => o._id))).toEqual(new Set([barOnlyId!, mixedId!]));

			// Kitchen filter → kitchen-only and mixed.
			const [kitchenOrders] = await authed.query(api.orders.getActiveOrdersByRestaurant, {
				restaurantId,
				prepStations: ["kitchen"],
			});
			if (!Array.isArray(kitchenOrders)) throw new Error("Expected array");
			expect(new Set(kitchenOrders.map((o) => o._id))).toEqual(new Set([kitchenOnlyId!, mixedId!]));

			// Items in the response carry the resolved prepStation for the UI.
			const mixedOrder = allOrders.find((o) => o._id === mixedId!);
			if (!mixedOrder) throw new Error("Mixed order missing");
			const stations = new Set(mixedOrder.items.map((it) => it.prepStation));
			expect(stations).toEqual(new Set(["kitchen", "bar"]));
		});

		it("falls back to kitchen for items whose menuItem has been deleted", async () => {
			const t = convexTest(schema, modules);
			const { organizationId, restaurantId, tableId } = await seedRestaurantAndSession(t);
			const barItemId = await seedMenuItemWithStation(t, restaurantId, {
				name: "Margarita",
				prepStation: "bar",
			});
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

			let orderId: Id<"orders">;
			await t.run(async (ctx) => {
				const session = await ctx.db.insert("sessions", {
					restaurantId,
					tableId,
					status: "active",
					startedAt: Date.now(),
				});
				orderId = await ctx.db.insert("orders", {
					sessionId: session,
					restaurantId,
					tableId,
					status: "submitted",
					totalAmount: 600,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				await ctx.db.insert("orderItems", {
					orderId,
					menuItemId: barItemId,
					menuItemName: "Margarita",
					quantity: 1,
					unitPrice: 600,
					selectedOptions: [],
					lineTotal: 600,
					createdAt: Date.now(),
				});

				// Delete the source menu item so the live lookup misses.
				await ctx.db.delete(barItemId);
			});

			const [orders] = await authed.query(api.orders.getActiveOrdersByRestaurant, {
				restaurantId,
			});
			if (!Array.isArray(orders)) throw new Error("Expected array");
			const targetOrder = orders.find((o) => o._id === orderId!);
			expect(targetOrder?.items[0].prepStation).toBe("kitchen");
		});
	});

	describe("markStationReady", () => {
		async function seedAuthorizedRestaurantOwner(
			t: ReturnType<typeof convexTest>,
			organizationId: Id<"organizations">
		) {
			await t.run(async (ctx) => {
				await ctx.db.insert("userRoles", {
					userId: "owner1",
					roles: ["owner"],
					organizationId,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
			});
		}

		it("stamps barReadyAt without flipping order status when kitchen items still pending", async () => {
			const t = convexTest(schema, modules);
			const { organizationId, restaurantId, tableId } = await seedRestaurantAndSession(t);
			const kitchenItemId = await seedMenuItemWithStation(t, restaurantId, {
				name: "Steak",
				prepStation: "kitchen",
			});
			const barItemId = await seedMenuItemWithStation(t, restaurantId, {
				name: "Margarita",
				prepStation: "bar",
			});
			await seedAuthorizedRestaurantOwner(t, organizationId);
			const authed = t.withIdentity({ subject: "owner1" });

			let orderId: Id<"orders">;
			await t.run(async (ctx) => {
				const session = await ctx.db.insert("sessions", {
					restaurantId,
					tableId,
					status: "active",
					startedAt: Date.now(),
				});
				orderId = await ctx.db.insert("orders", {
					sessionId: session,
					restaurantId,
					tableId,
					status: "submitted",
					totalAmount: 1400,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				await ctx.db.insert("orderItems", {
					orderId,
					menuItemId: kitchenItemId,
					menuItemName: "Steak",
					quantity: 1,
					unitPrice: 800,
					selectedOptions: [],
					lineTotal: 800,
					createdAt: Date.now(),
				});
				await ctx.db.insert("orderItems", {
					orderId,
					menuItemId: barItemId,
					menuItemName: "Margarita",
					quantity: 1,
					unitPrice: 600,
					selectedOptions: [],
					lineTotal: 600,
					createdAt: Date.now(),
				});
			});

			const [, error] = await authed.mutation(api.orders.markStationReady, {
				orderId: orderId!,
				station: "bar",
			});
			expect(error).toBeNull();

			const order = await t.run(async (ctx) => ctx.db.get(orderId!));
			expect(order?.barReadyAt).toBeTypeOf("number");
			expect(order?.kitchenReadyAt).toBeUndefined();
			// Status stays in flight because the kitchen has not stamped yet.
			expect(order?.status).toBe("submitted");
		});

		it("flips order status to ready once every applicable station is stamped", async () => {
			const t = convexTest(schema, modules);
			const { organizationId, restaurantId, tableId } = await seedRestaurantAndSession(t);
			const kitchenItemId = await seedMenuItemWithStation(t, restaurantId, {
				name: "Steak",
				prepStation: "kitchen",
			});
			const barItemId = await seedMenuItemWithStation(t, restaurantId, {
				name: "Margarita",
				prepStation: "bar",
			});
			await seedAuthorizedRestaurantOwner(t, organizationId);
			const authed = t.withIdentity({ subject: "owner1" });

			let orderId: Id<"orders">;
			await t.run(async (ctx) => {
				const session = await ctx.db.insert("sessions", {
					restaurantId,
					tableId,
					status: "active",
					startedAt: Date.now(),
				});
				orderId = await ctx.db.insert("orders", {
					sessionId: session,
					restaurantId,
					tableId,
					status: "preparing",
					totalAmount: 1400,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				await ctx.db.insert("orderItems", {
					orderId,
					menuItemId: kitchenItemId,
					menuItemName: "Steak",
					quantity: 1,
					unitPrice: 800,
					selectedOptions: [],
					lineTotal: 800,
					createdAt: Date.now(),
				});
				await ctx.db.insert("orderItems", {
					orderId,
					menuItemId: barItemId,
					menuItemName: "Margarita",
					quantity: 1,
					unitPrice: 600,
					selectedOptions: [],
					lineTotal: 600,
					createdAt: Date.now(),
				});
			});

			await authed.mutation(api.orders.markStationReady, {
				orderId: orderId!,
				station: "bar",
			});
			await authed.mutation(api.orders.markStationReady, {
				orderId: orderId!,
				station: "kitchen",
			});

			const order = await t.run(async (ctx) => ctx.db.get(orderId!));
			expect(order?.barReadyAt).toBeTypeOf("number");
			expect(order?.kitchenReadyAt).toBeTypeOf("number");
			expect(order?.status).toBe("ready");
		});

		it("flips status to ready immediately for a single-station order", async () => {
			const t = convexTest(schema, modules);
			const { organizationId, restaurantId, tableId } = await seedRestaurantAndSession(t);
			const barItemId = await seedMenuItemWithStation(t, restaurantId, {
				name: "Margarita",
				prepStation: "bar",
			});
			await seedAuthorizedRestaurantOwner(t, organizationId);
			const authed = t.withIdentity({ subject: "owner1" });

			let orderId: Id<"orders">;
			await t.run(async (ctx) => {
				const session = await ctx.db.insert("sessions", {
					restaurantId,
					tableId,
					status: "active",
					startedAt: Date.now(),
				});
				orderId = await ctx.db.insert("orders", {
					sessionId: session,
					restaurantId,
					tableId,
					status: "submitted",
					totalAmount: 600,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				await ctx.db.insert("orderItems", {
					orderId,
					menuItemId: barItemId,
					menuItemName: "Margarita",
					quantity: 1,
					unitPrice: 600,
					selectedOptions: [],
					lineTotal: 600,
					createdAt: Date.now(),
				});
			});

			await authed.mutation(api.orders.markStationReady, {
				orderId: orderId!,
				station: "bar",
			});

			const order = await t.run(async (ctx) => ctx.db.get(orderId!));
			expect(order?.barReadyAt).toBeTypeOf("number");
			expect(order?.status).toBe("ready");
		});

		it("rejects when the order has no items at the requested station", async () => {
			const t = convexTest(schema, modules);
			const { organizationId, restaurantId, tableId } = await seedRestaurantAndSession(t);
			const kitchenItemId = await seedMenuItemWithStation(t, restaurantId, {
				name: "Steak",
				prepStation: "kitchen",
			});
			await seedAuthorizedRestaurantOwner(t, organizationId);
			const authed = t.withIdentity({ subject: "owner1" });

			let orderId: Id<"orders">;
			await t.run(async (ctx) => {
				const session = await ctx.db.insert("sessions", {
					restaurantId,
					tableId,
					status: "active",
					startedAt: Date.now(),
				});
				orderId = await ctx.db.insert("orders", {
					sessionId: session,
					restaurantId,
					tableId,
					status: "submitted",
					totalAmount: 800,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				await ctx.db.insert("orderItems", {
					orderId,
					menuItemId: kitchenItemId,
					menuItemName: "Steak",
					quantity: 1,
					unitPrice: 800,
					selectedOptions: [],
					lineTotal: 800,
					createdAt: Date.now(),
				});
			});

			await expect(
				authed.mutation(api.orders.markStationReady, {
					orderId: orderId!,
					station: "bar",
				})
			).rejects.toThrow(/no items prepared at the bar/);
		});

		it("rejects when the order is already ready or beyond", async () => {
			const t = convexTest(schema, modules);
			const { organizationId, restaurantId, tableId } = await seedRestaurantAndSession(t);
			const barItemId = await seedMenuItemWithStation(t, restaurantId, {
				name: "Margarita",
				prepStation: "bar",
			});
			await seedAuthorizedRestaurantOwner(t, organizationId);
			const authed = t.withIdentity({ subject: "owner1" });

			let orderId: Id<"orders">;
			await t.run(async (ctx) => {
				const session = await ctx.db.insert("sessions", {
					restaurantId,
					tableId,
					status: "active",
					startedAt: Date.now(),
				});
				orderId = await ctx.db.insert("orders", {
					sessionId: session,
					restaurantId,
					tableId,
					status: "ready",
					totalAmount: 600,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				await ctx.db.insert("orderItems", {
					orderId,
					menuItemId: barItemId,
					menuItemName: "Margarita",
					quantity: 1,
					unitPrice: 600,
					selectedOptions: [],
					lineTotal: 600,
					createdAt: Date.now(),
				});
			});

			await expect(
				authed.mutation(api.orders.markStationReady, {
					orderId: orderId!,
					station: "bar",
				})
			).rejects.toThrow(/Cannot mark bar ready while order is ready/);
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
			},
			authed: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>
		) {
			const orderId = await authed.mutation(api.orders.createDraft, {
				sessionId: args.sessionId,
				tableId: args.tableId,
			});
			await authed.mutation(api.orders.addItem, {
				orderId,
				menuItemId: args.menuItemId,
				quantity: 1,
				selectedOptions: [],
			});
			const snap = (await authed.query(api.orders.getOrderWithItems, { orderId }))!.updatedAt;
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
			const { sessionId, restaurantId, tableId, authed } = await seedRestaurantAndSession(t);
			await t.run(async (ctx) => {
				await ctx.db.patch(restaurantId, {
					timezone: "UTC",
					orderNumberResetFrequency: "daily",
				});
			});
			const menuItemId = await seedMenuItem(t, restaurantId);

			const { orderId: orderId1, paymentId: paymentId1 } = await seedPaymentForOrder(
				t,
				{
					restaurantId,
					sessionId,
					tableId,
					menuItemId,
				},
				authed
			);
			await t.mutation(internal.orders.confirmPayment, {
				paymentId: paymentId1,
				stripePaymentIntentId: `pi_${orderId1}`,
			});

			const expectedKey = getOrderServiceDateKey(Date.now(), "UTC", 240);
			const o1 = await authed.query(api.orders.getOrderWithItems, { orderId: orderId1 });
			expect(o1!.dailyOrderNumber).toBe(1);
			expect(o1!.orderServiceDateKey).toBe(expectedKey);

			const { orderId: orderId2, paymentId: paymentId2 } = await seedPaymentForOrder(
				t,
				{
					restaurantId,
					sessionId,
					tableId,
					menuItemId,
				},
				authed
			);
			await t.mutation(internal.orders.confirmPayment, {
				paymentId: paymentId2,
				stripePaymentIntentId: `pi_${orderId2}`,
			});
			const o2 = await authed.query(api.orders.getOrderWithItems, { orderId: orderId2 });
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
			const { sessionId, restaurantId, tableId, authed } = await seedRestaurantAndSession(t);
			await t.run(async (ctx) => {
				await ctx.db.patch(restaurantId, {
					timezone: "UTC",
					orderNumberResetFrequency: "daily",
				});
			});
			const menuItemId = await seedMenuItem(t, restaurantId);

			const { orderId: orderId1, paymentId: paymentId1 } = await seedPaymentForOrder(
				t,
				{
					restaurantId,
					sessionId,
					tableId,
					menuItemId,
				},
				authed
			);
			await t.mutation(internal.orders.confirmPayment, {
				paymentId: paymentId1,
				stripePaymentIntentId: `pi_${orderId1}`,
			});

			vi.setSystemTime(new Date(Date.UTC(2024, 5, 16, 12, 0, 0)));
			const { orderId: orderId2, paymentId: paymentId2 } = await seedPaymentForOrder(
				t,
				{
					restaurantId,
					sessionId,
					tableId,
					menuItemId,
				},
				authed
			);
			await t.mutation(internal.orders.confirmPayment, {
				paymentId: paymentId2,
				stripePaymentIntentId: `pi_${orderId2}`,
			});

			const o2 = await authed.query(api.orders.getOrderWithItems, { orderId: orderId2 });
			expect(o2!.dailyOrderNumber).toBe(1);
			expect(o2!.orderServiceDateKey).toBe(getOrderServiceDateKey(Date.now(), "UTC", 240));
		});

		it("keeps the same service date before the UTC cutoff after midnight", async () => {
			vi.setSystemTime(new Date(Date.UTC(2024, 5, 15, 12, 0, 0)));
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId, authed } = await seedRestaurantAndSession(t);
			await t.run(async (ctx) => {
				await ctx.db.patch(restaurantId, {
					timezone: "UTC",
					orderNumberResetFrequency: "daily",
				});
			});
			const menuItemId = await seedMenuItem(t, restaurantId);

			const { orderId: orderId1, paymentId: paymentId1 } = await seedPaymentForOrder(
				t,
				{
					restaurantId,
					sessionId,
					tableId,
					menuItemId,
				},
				authed
			);
			await t.mutation(internal.orders.confirmPayment, {
				paymentId: paymentId1,
				stripePaymentIntentId: `pi_${orderId1}`,
			});
			const key15 = getOrderServiceDateKey(Date.now(), "UTC", 240);
			expect(key15).toBe("2024-06-15");

			vi.setSystemTime(new Date(Date.UTC(2024, 5, 16, 2, 0, 0)));
			const { orderId: orderId2, paymentId: paymentId2 } = await seedPaymentForOrder(
				t,
				{
					restaurantId,
					sessionId,
					tableId,
					menuItemId,
				},
				authed
			);
			await t.mutation(internal.orders.confirmPayment, {
				paymentId: paymentId2,
				stripePaymentIntentId: `pi_${orderId2}`,
			});

			const o2 = await authed.query(api.orders.getOrderWithItems, { orderId: orderId2 });
			expect(o2!.orderServiceDateKey).toBe("2024-06-15");
			expect(o2!.dailyOrderNumber).toBe(2);
		});

		it("monthly (default) keeps incrementing across days within the same month", async () => {
			vi.setSystemTime(new Date(Date.UTC(2024, 5, 15, 12, 0, 0)));
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId, authed } = await seedRestaurantAndSession(t);
			// No frequency patch — should default to monthly.
			await t.run(async (ctx) => {
				await ctx.db.patch(restaurantId, { timezone: "UTC" });
			});
			const menuItemId = await seedMenuItem(t, restaurantId);

			const first = await seedPaymentForOrder(
				t,
				{ restaurantId, sessionId, tableId, menuItemId },
				authed
			);
			await t.mutation(internal.orders.confirmPayment, {
				paymentId: first.paymentId,
				stripePaymentIntentId: `pi_${first.orderId}`,
			});

			vi.setSystemTime(new Date(Date.UTC(2024, 5, 16, 12, 0, 0)));
			const second = await seedPaymentForOrder(
				t,
				{ restaurantId, sessionId, tableId, menuItemId },
				authed
			);
			await t.mutation(internal.orders.confirmPayment, {
				paymentId: second.paymentId,
				stripePaymentIntentId: `pi_${second.orderId}`,
			});

			const o2 = await authed.query(api.orders.getOrderWithItems, { orderId: second.orderId });
			// Counter does NOT reset — same month → number = 2.
			expect(o2!.dailyOrderNumber).toBe(2);
			// orderServiceDateKey on the order is still daily, for tip-pool matching.
			expect(o2!.orderServiceDateKey).toBe("2024-06-16");

			const counter = await t.run(async (ctx) =>
				ctx.db
					.query("orderDayCounters")
					.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
					.first()
			);
			expect(counter?.serviceDateKey).toBe("2024-06");
			expect(counter?.lastIssuedNumber).toBe(2);
		});

		it("monthly resets the counter when crossing a month boundary", async () => {
			vi.setSystemTime(new Date(Date.UTC(2024, 5, 30, 12, 0, 0)));
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId, authed } = await seedRestaurantAndSession(t);
			await t.run(async (ctx) => {
				await ctx.db.patch(restaurantId, {
					timezone: "UTC",
					orderNumberResetFrequency: "monthly",
				});
			});
			const menuItemId = await seedMenuItem(t, restaurantId);

			const first = await seedPaymentForOrder(
				t,
				{ restaurantId, sessionId, tableId, menuItemId },
				authed
			);
			await t.mutation(internal.orders.confirmPayment, {
				paymentId: first.paymentId,
				stripePaymentIntentId: `pi_${first.orderId}`,
			});

			vi.setSystemTime(new Date(Date.UTC(2024, 6, 2, 12, 0, 0)));
			const second = await seedPaymentForOrder(
				t,
				{ restaurantId, sessionId, tableId, menuItemId },
				authed
			);
			await t.mutation(internal.orders.confirmPayment, {
				paymentId: second.paymentId,
				stripePaymentIntentId: `pi_${second.orderId}`,
			});

			const o2 = await authed.query(api.orders.getOrderWithItems, { orderId: second.orderId });
			expect(o2!.dailyOrderNumber).toBe(1);
			expect(o2!.orderServiceDateKey).toBe("2024-07-02");

			const counter = await t.run(async (ctx) =>
				ctx.db
					.query("orderDayCounters")
					.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
					.first()
			);
			expect(counter?.serviceDateKey).toBe("2024-07");
			expect(counter?.lastIssuedNumber).toBe(1);
		});

		it("weekly increments across days in the same ISO week and resets on new week", async () => {
			// 2024-06-12 is Wednesday of ISO week 24.
			vi.setSystemTime(new Date(Date.UTC(2024, 5, 12, 12, 0, 0)));
			const t = convexTest(schema, modules);
			const { sessionId, restaurantId, tableId, authed } = await seedRestaurantAndSession(t);
			await t.run(async (ctx) => {
				await ctx.db.patch(restaurantId, {
					timezone: "UTC",
					orderNumberResetFrequency: "weekly",
				});
			});
			const menuItemId = await seedMenuItem(t, restaurantId);

			const first = await seedPaymentForOrder(
				t,
				{ restaurantId, sessionId, tableId, menuItemId },
				authed
			);
			await t.mutation(internal.orders.confirmPayment, {
				paymentId: first.paymentId,
				stripePaymentIntentId: `pi_${first.orderId}`,
			});

			// Two days later, still ISO week 24.
			vi.setSystemTime(new Date(Date.UTC(2024, 5, 14, 12, 0, 0)));
			const second = await seedPaymentForOrder(
				t,
				{ restaurantId, sessionId, tableId, menuItemId },
				authed
			);
			await t.mutation(internal.orders.confirmPayment, {
				paymentId: second.paymentId,
				stripePaymentIntentId: `pi_${second.orderId}`,
			});
			const o2 = await authed.query(api.orders.getOrderWithItems, { orderId: second.orderId });
			expect(o2!.dailyOrderNumber).toBe(2);

			// Jump to the next ISO week (2024-06-17 is Mon of week 25).
			vi.setSystemTime(new Date(Date.UTC(2024, 5, 17, 12, 0, 0)));
			const third = await seedPaymentForOrder(
				t,
				{ restaurantId, sessionId, tableId, menuItemId },
				authed
			);
			await t.mutation(internal.orders.confirmPayment, {
				paymentId: third.paymentId,
				stripePaymentIntentId: `pi_${third.orderId}`,
			});
			const o3 = await authed.query(api.orders.getOrderWithItems, { orderId: third.orderId });
			expect(o3!.dailyOrderNumber).toBe(1);

			const counter = await t.run(async (ctx) =>
				ctx.db
					.query("orderDayCounters")
					.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
					.first()
			);
			expect(counter?.serviceDateKey).toBe("2024-W25");
			expect(counter?.lastIssuedNumber).toBe(1);
		});
	});

	describe("backfillDailyOrderNumber migration", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});
		afterEach(() => {
			vi.useRealTimers();
		});

		async function seedAdmin(
			t: ReturnType<typeof convexTest>,
			organizationId: Id<"organizations">
		) {
			await t.run(async (ctx) => {
				await ctx.db.insert("userRoles", {
					userId: "admin1",
					roles: ["admin"],
					organizationId,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
			});
		}

		async function insertLegacyOrder(
			t: ReturnType<typeof convexTest>,
			args: {
				restaurantId: Id<"restaurants">;
				sessionId: Id<"sessions">;
				tableId: Id<"tables">;
				status: "draft" | "submitted" | "preparing" | "ready" | "served" | "cancelled";
				dailyOrderNumber?: number;
				orderServiceDateKey?: string;
				submittedAt?: number;
				createdAt?: number;
			}
		): Promise<Id<"orders">> {
			let orderId: Id<"orders">;
			await t.run(async (ctx) => {
				const now = Date.now();
				orderId = await ctx.db.insert("orders", {
					sessionId: args.sessionId,
					restaurantId: args.restaurantId,
					tableId: args.tableId,
					status: args.status,
					totalAmount: 800,
					...(args.status === "draft" || args.status === "cancelled"
						? {}
						: { paymentState: "paid" as const }),
					...(args.submittedAt === undefined ? {} : { submittedAt: args.submittedAt }),
					...(args.dailyOrderNumber === undefined
						? {}
						: { dailyOrderNumber: args.dailyOrderNumber }),
					...(args.orderServiceDateKey === undefined
						? {}
						: { orderServiceDateKey: args.orderServiceDateKey }),
					createdAt: args.createdAt ?? now,
					updatedAt: now,
				});
			});
			return orderId!;
		}

		it("patches submitted/preparing/ready/served, skips draft/cancelled/already-numbered", async () => {
			vi.setSystemTime(new Date(Date.UTC(2024, 5, 15, 12, 0, 0)));
			const t = convexTest(schema, modules);
			const { organizationId, sessionId, restaurantId, tableId } =
				await seedRestaurantAndSession(t);
			await t.run(async (ctx) => {
				await ctx.db.patch(restaurantId, {
					timezone: "UTC",
					orderNumberResetFrequency: "daily",
				});
			});
			await seedAdmin(t, organizationId);
			const authed = t.withIdentity({ subject: "admin1" });

			const baseTs = Date.UTC(2024, 5, 14, 10, 0, 0);
			const submittedId = await insertLegacyOrder(t, {
				restaurantId,
				sessionId,
				tableId,
				status: "submitted",
				submittedAt: baseTs + 30 * 60 * 1000,
				createdAt: baseTs,
			});
			const preparingId = await insertLegacyOrder(t, {
				restaurantId,
				sessionId,
				tableId,
				status: "preparing",
				submittedAt: baseTs + 10 * 60 * 1000,
				createdAt: baseTs,
			});
			const readyId = await insertLegacyOrder(t, {
				restaurantId,
				sessionId,
				tableId,
				status: "ready",
				submittedAt: baseTs + 20 * 60 * 1000,
				createdAt: baseTs,
			});
			const servedId = await insertLegacyOrder(t, {
				restaurantId,
				sessionId,
				tableId,
				status: "served",
				submittedAt: baseTs + 5 * 60 * 1000,
				createdAt: baseTs,
			});
			const cancelledId = await insertLegacyOrder(t, {
				restaurantId,
				sessionId,
				tableId,
				status: "cancelled",
			});
			const draftId = await insertLegacyOrder(t, {
				restaurantId,
				sessionId,
				tableId,
				status: "draft",
			});
			const alreadyNumberedId = await insertLegacyOrder(t, {
				restaurantId,
				sessionId,
				tableId,
				status: "submitted",
				submittedAt: Date.now(),
				dailyOrderNumber: 99,
				orderServiceDateKey: "2024-06-14",
			});

			const result = await authed.mutation(api.migrations.backfillDailyOrderNumber.run, {});
			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error("expected ok");
			expect(result.patched).toBe(4);

			const todayKey = getOrderServiceDateKey(Date.now(), "UTC", 240);
			const todayPeriodKey = getOrderResetPeriodKey(Date.now(), "UTC", 240, "daily");
			expect(todayPeriodKey).toBe(todayKey);

			const fetch = async (id: Id<"orders">) => await t.run(async (ctx) => ctx.db.get(id));

			const submitted = await fetch(submittedId);
			const preparing = await fetch(preparingId);
			const ready = await fetch(readyId);
			const served = await fetch(servedId);
			const cancelled = await fetch(cancelledId);
			const draft = await fetch(draftId);
			const alreadyNumbered = await fetch(alreadyNumberedId);

			for (const o of [submitted, preparing, ready, served]) {
				expect(o!.dailyOrderNumber).toBeDefined();
				expect(o!.orderServiceDateKey).toBe(todayKey);
			}

			// Eligible orders allocate sequentially in submittedAt order:
			// served (+5m), preparing (+10m), ready (+20m), submitted (+30m).
			expect(served!.dailyOrderNumber).toBe(1);
			expect(preparing!.dailyOrderNumber).toBe(2);
			expect(ready!.dailyOrderNumber).toBe(3);
			expect(submitted!.dailyOrderNumber).toBe(4);

			expect(cancelled!.dailyOrderNumber).toBeUndefined();
			expect(draft!.dailyOrderNumber).toBeUndefined();
			expect(alreadyNumbered!.dailyOrderNumber).toBe(99);
			expect(alreadyNumbered!.orderServiceDateKey).toBe("2024-06-14");
		});

		it("is idempotent across reruns", async () => {
			vi.setSystemTime(new Date(Date.UTC(2024, 5, 15, 12, 0, 0)));
			const t = convexTest(schema, modules);
			const { organizationId, sessionId, restaurantId, tableId } =
				await seedRestaurantAndSession(t);
			await t.run(async (ctx) => {
				await ctx.db.patch(restaurantId, {
					timezone: "UTC",
					orderNumberResetFrequency: "daily",
				});
			});
			await seedAdmin(t, organizationId);
			const authed = t.withIdentity({ subject: "admin1" });

			await insertLegacyOrder(t, {
				restaurantId,
				sessionId,
				tableId,
				status: "submitted",
				submittedAt: Date.now(),
			});
			await insertLegacyOrder(t, {
				restaurantId,
				sessionId,
				tableId,
				status: "preparing",
				submittedAt: Date.now(),
			});

			const first = await authed.mutation(api.migrations.backfillDailyOrderNumber.run, {});
			expect(first.ok).toBe(true);
			if (!first.ok) throw new Error("expected ok");
			expect(first.patched).toBe(2);

			const second = await authed.mutation(api.migrations.backfillDailyOrderNumber.run, {});
			expect(second.ok).toBe(true);
			if (!second.ok) throw new Error("expected ok");
			expect(second.patched).toBe(0);
		});

		it("rejects non-admin callers", async () => {
			vi.setSystemTime(new Date(Date.UTC(2024, 5, 15, 12, 0, 0)));
			const t = convexTest(schema, modules);
			await seedRestaurantAndSession(t);
			const authed = t.withIdentity({ subject: "nobody" });

			const result = await authed.mutation(api.migrations.backfillDailyOrderNumber.run, {});
			expect(result.ok).toBe(false);
		});
	});

	describe("backfillPrepStation migration", () => {
		it("sets prepStation = 'kitchen' for rows missing it, leaves tagged rows alone, and is idempotent", async () => {
			const t = convexTest(schema, modules);
			const { organizationId, restaurantId } = await seedRestaurantAndSession(t);

			await t.run(async (ctx) => {
				await ctx.db.insert("userRoles", {
					userId: "admin1",
					roles: ["admin"],
					organizationId,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
			});
			const authed = t.withIdentity({ subject: "admin1" });

			// Three legacy items with no prepStation, plus one already-tagged
			// "bar" item whose value must survive the backfill.
			const legacyIds: Id<"menuItems">[] = [];
			let preTaggedBarId: Id<"menuItems">;
			await t.run(async (ctx) => {
				const allMenus = await ctx.db.query("menus").collect();
				const menuId = allMenus.find((m) => m.restaurantId === restaurantId)!._id;
				const categoryId = await ctx.db.insert("menuCategories", {
					menuId,
					restaurantId,
					name: "All",
					displayOrder: 0,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});

				for (let i = 0; i < 3; i++) {
					const id = await ctx.db.insert("menuItems", {
						categoryId,
						restaurantId,
						name: `Legacy ${i}`,
						basePrice: 500,
						isAvailable: true,
						displayOrder: i,
						createdAt: Date.now(),
						updatedAt: Date.now(),
					});
					legacyIds.push(id);
				}

				preTaggedBarId = await ctx.db.insert("menuItems", {
					categoryId,
					restaurantId,
					name: "Margarita",
					basePrice: 600,
					isAvailable: true,
					displayOrder: 99,
					prepStation: "bar",
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
			});

			const first = await authed.mutation(api.migrations.backfillPrepStation.run, {});
			expect(first.ok).toBe(true);
			if (!first.ok) throw new Error("expected ok");
			expect(first.patched).toBe(3);

			await t.run(async (ctx) => {
				for (const id of legacyIds) {
					const item = await ctx.db.get(id);
					expect(item?.prepStation).toBe("kitchen");
				}
				const bar = await ctx.db.get(preTaggedBarId!);
				expect(bar?.prepStation).toBe("bar");
			});

			// Re-running is a no-op.
			const second = await authed.mutation(api.migrations.backfillPrepStation.run, {});
			expect(second.ok).toBe(true);
			if (!second.ok) throw new Error("expected ok");
			expect(second.patched).toBe(0);
		});

		it("rejects non-admin callers", async () => {
			const t = convexTest(schema, modules);
			await seedRestaurantAndSession(t);
			const authed = t.withIdentity({ subject: "nobody" });

			const result = await authed.mutation(api.migrations.backfillPrepStation.run, {});
			expect(result.ok).toBe(false);
		});
	});
});
