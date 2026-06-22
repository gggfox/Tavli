import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { insertMenuForRestaurant } from "../menus";
import schema from "../schema";
import { ERROR_NAMES } from "../_shared/errors";

const modules = import.meta.glob("../**/*.ts");

const OWNER_ID = "owner1";
const DINER_A = "diner-a";
const DINER_B = "diner-b";
const INTRUDER = "intruder";

async function seedOrganization(t: ReturnType<typeof convexTest>) {
	let organizationId: Id<"organizations">;
	await t.run(async (ctx) => {
		organizationId = await ctx.db.insert("organizations", {
			name: "IDOR Test Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return organizationId!;
}

async function seedRestaurantWithSession(
	t: ReturnType<typeof convexTest>,
	args: { dinerId: string; slug?: string }
) {
	let restaurantId: Id<"restaurants">;
	let tableId: Id<"tables">;
	let sessionId: Id<"sessions">;

	const organizationId = await seedOrganization(t);

	await t.run(async (ctx) => {
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: OWNER_ID,
			organizationId,
			name: "IDOR Restaurant",
			slug: args.slug ?? "idor-r",
			currency: "USD",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});

		await insertMenuForRestaurant(ctx, {
			restaurantId,
			name: "main",
			userId: OWNER_ID,
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
			userId: args.dinerId,
			status: "active",
			startedAt: Date.now(),
		});
	});

	const diner = t.withIdentity({ subject: args.dinerId });

	return {
		organizationId,
		restaurantId: restaurantId!,
		tableId: tableId!,
		sessionId: sessionId!,
		diner,
	};
}

async function seedMenuItem(t: ReturnType<typeof convexTest>, restaurantId: Id<"restaurants">) {
	let menuItemId: Id<"menuItems">;
	await t.run(async (ctx) => {
		const menus = await ctx.db.query("menus").collect();
		const menuId =
			menus.find((m) => m.restaurantId === restaurantId)?._id ??
			(await insertMenuForRestaurant(ctx, {
				restaurantId,
				name: "main",
				userId: OWNER_ID,
			}));

		const categoryId = await ctx.db.insert("menuCategories", {
			menuId,
			restaurantId,
			name: "Mains",
			displayOrder: 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});

		menuItemId = await ctx.db.insert("menuItems", {
			categoryId,
			restaurantId,
			name: "Test Item",
			basePrice: 1000,
			isAvailable: true,
			displayOrder: 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return menuItemId!;
}

describe("diner session IDOR prevention (TAVLI-13)", () => {
	describe("sessions", () => {
		it("requires authentication to create a session", async () => {
			const t = convexTest(schema, modules);
			const organizationId = await seedOrganization(t);
			await t.run(async (ctx) => {
				await ctx.db.insert("restaurants", {
					ownerId: OWNER_ID,
					organizationId,
					name: "R",
					slug: "no-auth-r",
					currency: "USD",
					isActive: true,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
			});

			await expect(
				t.mutation(api.sessions.create, { restaurantSlug: "no-auth-r" })
			).rejects.toMatchObject({
				name: ERROR_NAMES.NOT_AUTHENTICATED,
			});
		});

		it("binds new sessions to the authenticated user", async () => {
			const t = convexTest(schema, modules);
			const organizationId = await seedOrganization(t);
			await t.run(async (ctx) => {
				await ctx.db.insert("restaurants", {
					ownerId: OWNER_ID,
					organizationId,
					name: "R",
					slug: "bind-r",
					currency: "USD",
					isActive: true,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
			});

			const diner = t.withIdentity({ subject: DINER_A });
			const result = await diner.mutation(api.sessions.create, { restaurantSlug: "bind-r" });

			const session = await diner.query(api.sessions.getActive, { sessionId: result.sessionId });
			expect(session?.userId).toBe(DINER_A);
		});

		it("returns null for getActive when another user queries the session", async () => {
			const t = convexTest(schema, modules);
			const { sessionId } = await seedRestaurantWithSession(t, { dinerId: DINER_A });
			const intruder = t.withIdentity({ subject: INTRUDER });

			const session = await intruder.query(api.sessions.getActive, { sessionId });
			expect(session).toBeNull();
		});

		it("rejects close from a non-owner", async () => {
			const t = convexTest(schema, modules);
			const { sessionId } = await seedRestaurantWithSession(t, { dinerId: DINER_A });
			const intruder = t.withIdentity({ subject: INTRUDER });

			await expect(intruder.mutation(api.sessions.close, { sessionId })).rejects.toThrow(
				"Active session not found"
			);
		});
	});

	describe("orders", () => {
		it("rejects unauthenticated createDraft", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, tableId } = await seedRestaurantWithSession(t, { dinerId: DINER_A });

			await expect(
				t.mutation(api.orders.createDraft, { sessionId, tableId })
			).rejects.toMatchObject({
				name: ERROR_NAMES.NOT_AUTHENTICATED,
			});
		});

		it("rejects createDraft when session belongs to another user", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, tableId } = await seedRestaurantWithSession(t, { dinerId: DINER_A });
			const dinerB = t.withIdentity({ subject: DINER_B });

			await expect(dinerB.mutation(api.orders.createDraft, { sessionId, tableId })).rejects.toThrow(
				"Active session not found"
			);
		});

		it("rejects addItem on another user's draft order", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, tableId, restaurantId, diner } = await seedRestaurantWithSession(t, {
				dinerId: DINER_A,
			});
			const menuItemId = await seedMenuItem(t, restaurantId);
			const orderId = await diner.mutation(api.orders.createDraft, { sessionId, tableId });
			const intruder = t.withIdentity({ subject: INTRUDER });

			await expect(
				intruder.mutation(api.orders.addItem, {
					orderId,
					menuItemId,
					quantity: 1,
					selectedOptions: [],
				})
			).rejects.toMatchObject({
				name: "NOT_FOUND",
			});
		});

		it("returns null for getOrderWithItems when queried by non-owner", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, tableId, restaurantId, diner } = await seedRestaurantWithSession(t, {
				dinerId: DINER_A,
			});
			const menuItemId = await seedMenuItem(t, restaurantId);
			const orderId = await diner.mutation(api.orders.createDraft, { sessionId, tableId });
			await diner.mutation(api.orders.addItem, {
				orderId,
				menuItemId,
				quantity: 1,
				selectedOptions: [],
			});

			const intruder = t.withIdentity({ subject: INTRUDER });
			const order = await intruder.query(api.orders.getOrderWithItems, { orderId });
			expect(order).toBeNull();
		});

		it("returns empty list for getOrdersBySession when queried by non-owner", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, tableId, diner } = await seedRestaurantWithSession(t, {
				dinerId: DINER_A,
			});
			const intruder = t.withIdentity({ subject: INTRUDER });

			await diner.mutation(api.orders.createDraft, { sessionId, tableId });

			const orders = await intruder.query(api.orders.getOrdersBySession, { sessionId });
			expect(orders).toEqual([]);
		});

		it("strips sensitive payment fields from diner getOrderWithItems", async () => {
			const t = convexTest(schema, modules);
			const { sessionId, tableId, restaurantId, diner } = await seedRestaurantWithSession(t, {
				dinerId: DINER_A,
			});
			const menuItemId = await seedMenuItem(t, restaurantId);
			const orderId = await diner.mutation(api.orders.createDraft, { sessionId, tableId });
			await diner.mutation(api.orders.addItem, {
				orderId,
				menuItemId,
				quantity: 1,
				selectedOptions: [],
			});

			let paymentId: Id<"payments">;
			await t.run(async (ctx) => {
				paymentId = await ctx.db.insert("payments", {
					restaurantId,
					orderId,
					amount: 1000,
					currency: "usd",
					status: "processing",
					refundStatus: "none",
					attemptNumber: 1,
					stripePaymentIntentId: "pi_secret_should_not_leak",
					stripeChargeId: "ch_secret_should_not_leak",
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
				await ctx.db.patch(orderId, { activePaymentId: paymentId });
			});

			const order = await diner.query(api.orders.getOrderWithItems, { orderId });
			expect(order?.activePayment).toEqual({
				status: "processing",
			});
			expect(order?.activePayment).not.toHaveProperty("stripePaymentIntentId");
			expect(order?.activePayment).not.toHaveProperty("stripeChargeId");
		});
	});
});
