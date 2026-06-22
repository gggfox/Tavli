import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE, SHIFT_STATUS, TIP_ENTRY_SOURCE, USER_ROLES } from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const HOUR = 60 * 60 * 1000;

interface SeedOut {
	orgId: Id<"organizations">;
	restaurantId: Id<"restaurants">;
	otherRestaurantId: Id<"restaurants">;
	employeeMember: Id<"restaurantMembers">;
	otherRestaurantMember: Id<"restaurantMembers">;
	shiftId: Id<"shifts">;
	otherRestaurantShiftId: Id<"shifts">;
}

async function seedTips(t: ReturnType<typeof convexTest>): Promise<SeedOut> {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const orgId = await ctx.db.insert("organizations", {
			name: "Tips Org",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-user",
			organizationId: orgId,
			name: "Tips R",
			slug: "tips-r",
			currency: "USD",
			timezone: "UTC",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const otherRestaurantId = await ctx.db.insert("restaurants", {
			ownerId: "owner-user",
			organizationId: orgId,
			name: "Other Tips R",
			slug: "other-tips-r",
			currency: "USD",
			timezone: "UTC",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("userRoles", {
			userId: "manager-user",
			roles: [USER_ROLES.MANAGER],
			organizationId: orgId,
			createdAt: now,
			updatedAt: now,
		});
		const employeeMember = await ctx.db.insert("restaurantMembers", {
			userId: "employee-user",
			restaurantId,
			organizationId: orgId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const otherRestaurantMember = await ctx.db.insert("restaurantMembers", {
			userId: "other-employee-user",
			restaurantId: otherRestaurantId,
			organizationId: orgId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("restaurantMembers", {
			userId: "manager-user",
			restaurantId,
			organizationId: orgId,
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const startsAt = now + 24 * HOUR;
		const shiftId = await ctx.db.insert("shifts", {
			memberId: employeeMember,
			restaurantId,
			startsAt,
			endsAt: startsAt + 8 * HOUR,
			status: SHIFT_STATUS.SCHEDULED,
			createdBy: "manager-user",
			createdAt: now,
			updatedAt: now,
			updatedBy: "manager-user",
		});
		const otherRestaurantShiftId = await ctx.db.insert("shifts", {
			memberId: otherRestaurantMember,
			restaurantId: otherRestaurantId,
			startsAt,
			endsAt: startsAt + 8 * HOUR,
			status: SHIFT_STATUS.SCHEDULED,
			createdBy: "manager-user",
			createdAt: now,
			updatedAt: now,
			updatedBy: "manager-user",
		});
		return {
			orgId,
			restaurantId,
			otherRestaurantId,
			employeeMember,
			otherRestaurantMember,
			shiftId,
			otherRestaurantShiftId,
		};
	});
}

describe("addTipEntry scoping", () => {
	it("accepts memberId and shiftId scoped to the restaurant", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, employeeMember, shiftId } = await seedTips(t);
		const authed = t.withIdentity({ subject: "manager-user" });

		const [id, err] = await authed.mutation(api.tips.addTipEntry, {
			restaurantId,
			businessDate: "2026-06-21",
			amountCents: 500,
			source: TIP_ENTRY_SOURCE.CASH,
			memberId: employeeMember,
			shiftId,
		});

		expect(err).toBeNull();
		expect(id).toBeTruthy();
	});

	it("rejects memberId from another restaurant", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, otherRestaurantMember } = await seedTips(t);
		const authed = t.withIdentity({ subject: "manager-user" });

		const [id, err] = await authed.mutation(api.tips.addTipEntry, {
			restaurantId,
			businessDate: "2026-06-21",
			amountCents: 500,
			source: TIP_ENTRY_SOURCE.CASH,
			memberId: otherRestaurantMember,
		});

		expect(id).toBeNull();
		expect(err?.message).toBe("Team member not found for restaurant");
	});

	it("rejects shiftId from another restaurant", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, otherRestaurantShiftId } = await seedTips(t);
		const authed = t.withIdentity({ subject: "manager-user" });

		const [id, err] = await authed.mutation(api.tips.addTipEntry, {
			restaurantId,
			businessDate: "2026-06-21",
			amountCents: 500,
			source: TIP_ENTRY_SOURCE.CASH,
			shiftId: otherRestaurantShiftId,
		});

		expect(id).toBeNull();
		expect(err?.message).toBe("Shift not found");
	});

	it("rejects inactive memberId for the restaurant", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, employeeMember } = await seedTips(t);
		await t.run(async (ctx) => {
			await ctx.db.patch(employeeMember, { isActive: false });
		});
		const authed = t.withIdentity({ subject: "manager-user" });

		const [id, err] = await authed.mutation(api.tips.addTipEntry, {
			restaurantId,
			businessDate: "2026-06-21",
			amountCents: 500,
			source: TIP_ENTRY_SOURCE.CASH,
			memberId: employeeMember,
		});

		expect(id).toBeNull();
		expect(err?.message).toBe("Team member not found for restaurant");
	});
});
