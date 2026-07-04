import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE, USER_ROLES } from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

async function seedRestaurantWithMembers(t: ReturnType<typeof convexTest>) {
	let organizationId: Id<"organizations">;
	let restaurantId: Id<"restaurants">;

	await t.run(async (ctx) => {
		const now = Date.now();
		organizationId = await ctx.db.insert("organizations", {
			name: "Import Test Org",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-user",
			name: "Import Test Restaurant",
			slug: "import-test",
			currency: "USD",
			organizationId,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("restaurantMembers", {
			userId: "manager-user",
			restaurantId,
			organizationId,
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
			isActive: true,
			addedBy: "owner-user",
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("restaurantMembers", {
			userId: "employee-user",
			restaurantId,
			organizationId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
			isActive: true,
			addedBy: "owner-user",
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("userRoles", {
			userId: "owner-user",
			roles: [USER_ROLES.OWNER],
			organizationId,
			createdAt: now,
			updatedAt: now,
		});
	});

	return { organizationId: organizationId!, restaurantId: restaurantId! };
}

describe("menuImportMutation.verifyMenuImportAccess", () => {
	it("allows restaurant managers", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedRestaurantWithMembers(t);

		const result = await t.query(internal.menuImportMutation.verifyMenuImportAccess, {
			userId: "manager-user",
			restaurantId,
		});

		expect(result).toEqual({ allowed: true, errorMessage: undefined });
	});

	it("allows org owners without explicit restaurant membership", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedRestaurantWithMembers(t);

		const result = await t.query(internal.menuImportMutation.verifyMenuImportAccess, {
			userId: "owner-user",
			restaurantId,
		});

		expect(result).toEqual({ allowed: true, errorMessage: undefined });
	});

	it("denies restaurant employees", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedRestaurantWithMembers(t);

		const result = await t.query(internal.menuImportMutation.verifyMenuImportAccess, {
			userId: "employee-user",
			restaurantId,
		});

		expect(result.allowed).toBe(false);
		expect(result.errorMessage).toBeTruthy();
	});

	it("denies unrelated authenticated users", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedRestaurantWithMembers(t);

		const result = await t.query(internal.menuImportMutation.verifyMenuImportAccess, {
			userId: "stranger-user",
			restaurantId,
		});

		expect(result.allowed).toBe(false);
	});
});
