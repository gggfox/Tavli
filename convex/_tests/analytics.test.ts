/**
 * Tests for the dashboard analytics queries added for TAVLI-2:
 * - numberWithDelta `orders.avgDishValue` / `orders.avgCheck` (manager-gated)
 * - activeOrders (live snapshot)
 * - itemsByCategory (revenue per MenuCategory, live category lookup)
 * - serverPerformance (attributed sales ranking, manager-gated, name resolution)
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE } from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

type T = ReturnType<typeof convexTest>;

async function seedOrgAndRestaurant(t: T) {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const orgId = await ctx.db.insert("organizations", {
			name: "Analytics Org",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "seed-owner",
			organizationId: orgId,
			name: "R1",
			slug: "analytics-test-r1",
			currency: "USD",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		return { orgId, restaurantId };
	});
}

async function seedMembership(
	t: T,
	args: {
		userId: string;
		restaurantId: Id<"restaurants">;
		orgId: Id<"organizations">;
		role: "manager" | "employee";
	}
): Promise<Id<"restaurantMembers">> {
	return await t.run(async (ctx) => {
		const now = Date.now();
		return await ctx.db.insert("restaurantMembers", {
			userId: args.userId,
			restaurantId: args.restaurantId,
			organizationId: args.orgId,
			role: args.role,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
	});
}

/**
 * Seeds one served+paid order (with two line items across two categories,
 * attributed to `serverMemberId`) and one in-flight (preparing) order on an
 * open session. Returns the time window covering them.
 */
async function seedScenario(
	t: T,
	restaurantId: Id<"restaurants">,
	serverMemberId: Id<"restaurantMembers">
) {
	return await t.run(async (ctx) => {
		const now = Date.now();

		// userRoles row backing the attributed server, for name resolution.
		await ctx.db.insert("userRoles", {
			userId: "server1",
			firstName: "Ana",
			paternalLastname: "García",
			roles: ["employee"],
			createdAt: now,
			updatedAt: now,
		});

		const menuId = await ctx.db.insert("menus", {
			restaurantId,
			name: "Main",
			isActive: true,
			displayOrder: 0,
			createdAt: now,
			updatedAt: now,
		});
		const mainsId = await ctx.db.insert("menuCategories", {
			menuId,
			restaurantId,
			name: "Mains",
			displayOrder: 0,
			createdAt: now,
			updatedAt: now,
		});
		const drinksId = await ctx.db.insert("menuCategories", {
			menuId,
			restaurantId,
			name: "Drinks",
			displayOrder: 1,
			createdAt: now,
			updatedAt: now,
		});
		const burgerId = await ctx.db.insert("menuItems", {
			categoryId: mainsId,
			restaurantId,
			name: "Burger",
			basePrice: 50,
			isAvailable: true,
			displayOrder: 0,
			createdAt: now,
			updatedAt: now,
		});
		const sodaId = await ctx.db.insert("menuItems", {
			categoryId: drinksId,
			restaurantId,
			name: "Soda",
			basePrice: 30,
			isAvailable: true,
			displayOrder: 0,
			createdAt: now,
			updatedAt: now,
		});

		const tableId = await ctx.db.insert("tables", {
			restaurantId,
			tableNumber: 1,
			isActive: true,
			createdAt: now,
		});
		const sessionId = await ctx.db.insert("sessions", {
			restaurantId,
			tableId,
			status: "active",
			startedAt: now,
		});

		// Paid + served order attributed to the server.
		const paidOrderId = await ctx.db.insert("orders", {
			sessionId,
			restaurantId,
			tableId,
			status: "served",
			totalAmount: 220,
			paidAt: now,
			submittedAt: now,
			attributedMemberId: serverMemberId,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("orderItems", {
			orderId: paidOrderId,
			menuItemId: burgerId,
			menuItemName: "Burger",
			quantity: 2,
			unitPrice: 50,
			selectedOptions: [],
			lineTotal: 100,
			createdAt: now,
		});
		await ctx.db.insert("orderItems", {
			orderId: paidOrderId,
			menuItemId: sodaId,
			menuItemName: "Soda",
			quantity: 4,
			unitPrice: 30,
			selectedOptions: [],
			lineTotal: 120,
			createdAt: now,
		});
		await ctx.db.insert("payments", {
			restaurantId,
			orderId: paidOrderId,
			amount: 220,
			currency: "USD",
			status: "succeeded",
			refundStatus: "none",
			attemptNumber: 1,
			succeededAt: now,
			createdAt: now,
			updatedAt: now,
		});

		// In-flight (active) order, no items, not paid.
		await ctx.db.insert("orders", {
			sessionId,
			restaurantId,
			tableId,
			status: "preparing",
			totalAmount: 50,
			createdAt: now,
			updatedAt: now,
		});

		const range = { from: now - 86_400_000, to: now + 86_400_000 };
		return { range };
	});
}

describe("analytics.serverPerformance", () => {
	it("ranks attributed sales with resolved name for a manager", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		await seedMembership(t, {
			userId: "mgr",
			restaurantId,
			orgId,
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
		});
		const serverMemberId = await seedMembership(t, {
			userId: "server1",
			restaurantId,
			orgId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
		});
		const { range } = await seedScenario(t, restaurantId, serverMemberId);

		const manager = t.withIdentity({ subject: "mgr" });
		const [rows, err] = await manager.query(api.analytics.serverPerformance.compute, {
			restaurantId,
			range,
		});
		expect(err).toBeNull();
		expect(rows).toHaveLength(1);
		expect(rows?.[0]).toMatchObject({
			name: "Ana García",
			sales: 220,
			orders: 1,
			avgCheck: 220,
		});
	});

	it("is forbidden for employees", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		await seedMembership(t, {
			userId: "emp",
			restaurantId,
			orgId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
		});

		const employee = t.withIdentity({ subject: "emp" });
		const [, err] = await employee.query(api.analytics.serverPerformance.compute, {
			restaurantId,
			range: { from: 0, to: 1 },
		});
		expect(err?.name).toBe("NOT_AUTHORIZED");
	});
});

describe("analytics.itemsByCategory", () => {
	it("aggregates revenue per category, sorted desc", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		const serverMemberId = await seedMembership(t, {
			userId: "server1",
			restaurantId,
			orgId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
		});
		const { range } = await seedScenario(t, restaurantId, serverMemberId);

		const staff = t.withIdentity({ subject: "server1" });
		const [rows, err] = await staff.query(api.analytics.itemsByCategory.compute, {
			restaurantId,
			range,
		});
		expect(err).toBeNull();
		expect(rows).toEqual([
			expect.objectContaining({ categoryName: "Drinks", revenue: 120 }),
			expect.objectContaining({ categoryName: "Mains", revenue: 100 }),
		]);
	});
});

describe("analytics.activeOrders", () => {
	it("reports open sessions and in-flight orders", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		const serverMemberId = await seedMembership(t, {
			userId: "server1",
			restaurantId,
			orgId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
		});
		await seedScenario(t, restaurantId, serverMemberId);

		const staff = t.withIdentity({ subject: "server1" });
		const [result, err] = await staff.query(api.analytics.activeOrders.compute, { restaurantId });
		expect(err).toBeNull();
		expect(result).toEqual({ seatedTables: 1, activeOrderCount: 1, activeOrderValue: 50 });
	});
});

describe("analytics.numberWithDelta avg metrics", () => {
	it("computes avgDishValue and avgCheck for a manager", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		const serverMemberId = await seedMembership(t, {
			userId: "mgr",
			restaurantId,
			orgId,
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
		});
		const { range } = await seedScenario(t, restaurantId, serverMemberId);

		const manager = t.withIdentity({ subject: "mgr" });

		const [dish, dishErr] = await manager.query(api.analytics.numberWithDelta.compute, {
			scopeKind: "restaurant",
			restaurantId,
			metric: "orders.avgDishValue",
			range,
			compareToPrev: false,
		});
		expect(dishErr).toBeNull();
		expect(dish?.current).toBeCloseTo(220 / 6, 5); // (100 + 120) / (2 + 4)

		const [check, checkErr] = await manager.query(api.analytics.numberWithDelta.compute, {
			scopeKind: "restaurant",
			restaurantId,
			metric: "orders.avgCheck",
			range,
			compareToPrev: false,
		});
		expect(checkErr).toBeNull();
		expect(check?.current).toBe(220); // 220 revenue / 1 paid order
	});

	it("forbids employees from money metrics", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		await seedMembership(t, {
			userId: "emp",
			restaurantId,
			orgId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
		});

		const employee = t.withIdentity({ subject: "emp" });
		const [, err] = await employee.query(api.analytics.numberWithDelta.compute, {
			scopeKind: "restaurant",
			restaurantId,
			metric: "orders.avgCheck",
			range: { from: 0, to: 1 },
			compareToPrev: false,
		});
		expect(err?.name).toBe("NOT_AUTHORIZED");
	});
});
