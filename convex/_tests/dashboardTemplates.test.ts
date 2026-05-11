import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE } from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

async function seedOrgAndRestaurant(t: ReturnType<typeof convexTest>) {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const orgId = await ctx.db.insert("organizations", {
			name: "Templates Org",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "seed-owner",
			organizationId: orgId,
			name: "R1",
			slug: "templates-test-r1",
			currency: "USD",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		return { orgId, restaurantId };
	});
}

async function seedMembership(
	t: ReturnType<typeof convexTest>,
	args: {
		userId: string;
		restaurantId: Id<"restaurants">;
		orgId: Id<"organizations">;
		role: "manager" | "employee";
	}
) {
	await t.run(async (ctx) => {
		const now = Date.now();
		await ctx.db.insert("restaurantMembers", {
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

const baseConfig = {
	globalDateRange: "week" as const,
	compareToPrev: false,
	widgets: [],
};

describe("dashboardTemplates.publish", () => {
	it("manager-or-above may publish", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		await seedMembership(t, {
			userId: "manager1",
			restaurantId,
			orgId,
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
		});

		const manager = t.withIdentity({ subject: "manager1" });
		const [id, err] = await manager.mutation(api.dashboardTemplates.publish, {
			restaurantId,
			name: "Lunch view",
			config: baseConfig,
		});
		expect(err).toBeNull();
		expect(id).toBeTruthy();
	});

	it("employees cannot publish", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		await seedMembership(t, {
			userId: "emp1",
			restaurantId,
			orgId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
		});

		const employee = t.withIdentity({ subject: "emp1" });
		const [, err] = await employee.mutation(api.dashboardTemplates.publish, {
			restaurantId,
			name: "Should fail",
			config: baseConfig,
		});
		expect(err?.name).toBe("NOT_AUTHORIZED");
	});
});

describe("dashboardTemplates.cloneToLayout", () => {
	it("any staff member with restaurant access may clone, producing an independent layout", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		await seedMembership(t, {
			userId: "manager1",
			restaurantId,
			orgId,
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
		});
		await seedMembership(t, {
			userId: "emp1",
			restaurantId,
			orgId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
		});

		const manager = t.withIdentity({ subject: "manager1" });
		const [templateId] = await manager.mutation(
			api.dashboardTemplates.publish,
			{
				restaurantId,
				name: "Owner view",
				config: baseConfig,
			}
		);
		if (!templateId) throw new Error("template publish failed");

		const employee = t.withIdentity({ subject: "emp1" });
		const [layoutId, err] = await employee.mutation(
			api.dashboardTemplates.cloneToLayout,
			{
				templateId,
				name: "My copy",
			}
		);
		expect(err).toBeNull();
		expect(layoutId).toBeTruthy();

		const [layouts] = await employee.query(api.dashboardLayouts.list, {
			scopeKind: "restaurant",
			restaurantId,
		});
		expect(layouts).toHaveLength(1);
		expect(layouts?.[0]?.userId).toBe("emp1");
		expect(layouts?.[0]?.name).toBe("My copy");
	});

	it("strangers without restaurant access cannot clone", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		await seedMembership(t, {
			userId: "manager1",
			restaurantId,
			orgId,
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
		});

		const manager = t.withIdentity({ subject: "manager1" });
		const [templateId] = await manager.mutation(
			api.dashboardTemplates.publish,
			{
				restaurantId,
				name: "Owner view",
				config: baseConfig,
			}
		);
		if (!templateId) throw new Error("template publish failed");

		const stranger = t.withIdentity({ subject: "stranger" });
		const [, err] = await stranger.mutation(
			api.dashboardTemplates.cloneToLayout,
			{
				templateId,
			}
		);
		expect(err?.name).toBe("NOT_AUTHORIZED");
	});
});
