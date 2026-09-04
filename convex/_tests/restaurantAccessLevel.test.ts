/**
 * "Am I a manager here?" for the client (TAVLI-101).
 *
 * The collision banner is the part of the floor alert that says *escalate*, so
 * it is manager-and-above only — while the red cards themselves stay visible to
 * everyone, because hiding a double-booking from the employee standing at that
 * table would be absurd.
 *
 * Every reservation mutation gates on `requireRestaurantStaffAccess`, so there
 * was no client-visible notion of "manager" before this.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE } from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

async function seed(t: ReturnType<typeof convexTest>) {
	let restaurantId: Id<"restaurants">;
	await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", {
			name: "Access Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-access",
			organizationId,
			name: "Access Restaurant",
			slug: `access-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		for (const [userId, role] of [
			["manager-access", RESTAURANT_MEMBER_ROLE.MANAGER],
			["employee-access", RESTAURANT_MEMBER_ROLE.EMPLOYEE],
		] as const) {
			await ctx.db.insert("restaurantMembers", {
				restaurantId,
				organizationId,
				userId,
				role,
				isActive: true,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			});
		}
	});
	return restaurantId!;
}

describe("restaurantMembers.myAccessLevel", () => {
	it("tells a manager they are one", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seed(t);

		const result = await t
			.withIdentity({ subject: "manager-access" })
			.query(api.restaurantMembers.myAccessLevel, { restaurantId });

		expect(result.isManagerOrAbove).toBe(true);
	});

	it("does not promote an employee", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seed(t);

		const result = await t
			.withIdentity({ subject: "employee-access" })
			.query(api.restaurantMembers.myAccessLevel, { restaurantId });

		expect(result.isManagerOrAbove).toBe(false);
	});

	it("says no rather than throwing for a signed-out visitor", async () => {
		const t = convexTest(schema, modules);
		const restaurantId = await seed(t);

		const result = await t.query(api.restaurantMembers.myAccessLevel, { restaurantId });

		expect(result.isManagerOrAbove).toBe(false);
	});
});
