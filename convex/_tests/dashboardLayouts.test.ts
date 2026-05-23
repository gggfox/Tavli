import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE, USER_ROLES } from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

async function seedOrgAndRestaurant(
	t: ReturnType<typeof convexTest>,
	args: { ownerId?: string } = {}
): Promise<{
	orgId: Id<"organizations">;
	restaurantId: Id<"restaurants">;
}> {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const orgId = await ctx.db.insert("organizations", {
			name: "Dashboard Test Org",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: args.ownerId ?? "seed-owner",
			organizationId: orgId,
			name: "R1",
			slug: "dashboard-test-r1",
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

describe("dashboardLayouts.create", () => {
	it("creates a restaurant-scoped layout for a staff member", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		await seedMembership(t, {
			userId: "staff1",
			restaurantId,
			orgId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
		});

		const authed = t.withIdentity({ subject: "staff1" });
		const [id, err] = await authed.mutation(api.dashboardLayouts.create, {
			scopeKind: "restaurant",
			restaurantId,
			name: "My layout",
			config: baseConfig,
		});

		expect(err).toBeNull();
		expect(id).toBeTruthy();

		const [rows, listErr] = await authed.query(api.dashboardLayouts.list, {
			scopeKind: "restaurant",
			restaurantId,
		});
		expect(listErr).toBeNull();
		expect(rows).toHaveLength(1);
		expect(rows?.[0]?.name).toBe("My layout");
		expect(rows?.[0]?.position).toBe(0);
	});

	it("rejects creation for a user without staff access at the restaurant", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedOrgAndRestaurant(t);

		const stranger = t.withIdentity({ subject: "stranger" });
		const [id, err] = await stranger.mutation(api.dashboardLayouts.create, {
			scopeKind: "restaurant",
			restaurantId,
			name: "Sneaky",
			config: baseConfig,
		});

		expect(id).toBeNull();
		expect(err?.name).toBe("NOT_AUTHORIZED");
	});

	it("rejects empty names", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		await seedMembership(t, {
			userId: "staff1",
			restaurantId,
			orgId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
		});

		const authed = t.withIdentity({ subject: "staff1" });
		const [id, err] = await authed.mutation(api.dashboardLayouts.create, {
			scopeKind: "restaurant",
			restaurantId,
			name: "   ",
			config: baseConfig,
		});

		expect(id).toBeNull();
		expect(err?.name).toBe("VALIDATION_ERROR");
	});

	it("creates portfolio layouts for any user with at least one active membership", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		await seedMembership(t, {
			userId: "manager1",
			restaurantId,
			orgId,
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
		});

		const authed = t.withIdentity({ subject: "manager1" });
		const [id, err] = await authed.mutation(api.dashboardLayouts.create, {
			scopeKind: "portfolio",
			name: "Portfolio",
			config: baseConfig,
		});

		expect(err).toBeNull();
		expect(id).toBeTruthy();
	});

	it("rejects portfolio layout creation for users with no memberships", async () => {
		const t = convexTest(schema, modules);
		const stranger = t.withIdentity({ subject: "lonely" });
		const [, err] = await stranger.mutation(api.dashboardLayouts.create, {
			scopeKind: "portfolio",
			name: "Portfolio",
			config: baseConfig,
		});
		expect(err?.name).toBe("NOT_AUTHORIZED");
	});
});

describe("dashboardLayouts.update / get / remove", () => {
	it("only the owner can update / delete / read full detail", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		await seedMembership(t, {
			userId: "owner-staff",
			restaurantId,
			orgId,
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
		});
		await seedMembership(t, {
			userId: "peer-staff",
			restaurantId,
			orgId,
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
		});

		const owner = t.withIdentity({ subject: "owner-staff" });
		const [layoutId] = await owner.mutation(api.dashboardLayouts.create, {
			scopeKind: "restaurant",
			restaurantId,
			name: "Mine",
			config: baseConfig,
		});
		if (!layoutId) throw new Error("layout creation failed");

		const peer = t.withIdentity({ subject: "peer-staff" });

		const [, getErr] = await peer.query(api.dashboardLayouts.get, {
			layoutId,
		});
		expect(getErr?.name).toBe("NOT_AUTHORIZED");

		const [, updateErr] = await peer.mutation(api.dashboardLayouts.update, {
			layoutId,
			name: "Hijacked",
		});
		expect(updateErr?.name).toBe("NOT_AUTHORIZED");

		const [, removeErr] = await peer.mutation(api.dashboardLayouts.remove, {
			layoutId,
		});
		expect(removeErr?.name).toBe("NOT_AUTHORIZED");

		const [updatedId, ownErr] = await owner.mutation(api.dashboardLayouts.update, {
			layoutId,
			name: "Renamed",
		});
		expect(ownErr).toBeNull();
		expect(updatedId).toBe(layoutId);
	});

	it("admins may read any layout", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		await seedMembership(t, {
			userId: "owner-staff",
			restaurantId,
			orgId,
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
		});
		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert("userRoles", {
				userId: "an-admin",
				roles: [USER_ROLES.ADMIN],
				createdAt: now,
				updatedAt: now,
			});
		});

		const owner = t.withIdentity({ subject: "owner-staff" });
		const [layoutId] = await owner.mutation(api.dashboardLayouts.create, {
			scopeKind: "restaurant",
			restaurantId,
			name: "Mine",
			config: baseConfig,
		});
		if (!layoutId) throw new Error("layout creation failed");

		const admin = t.withIdentity({ subject: "an-admin" });
		const [layout, err] = await admin.query(api.dashboardLayouts.get, {
			layoutId,
		});
		expect(err).toBeNull();
		expect(layout?._id).toBe(layoutId);
	});
});

describe("dashboardLayouts.duplicate / reorder", () => {
	it("duplicate creates an independent copy at the end", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		await seedMembership(t, {
			userId: "staff1",
			restaurantId,
			orgId,
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
		});

		const user = t.withIdentity({ subject: "staff1" });
		const [originalId] = await user.mutation(api.dashboardLayouts.create, {
			scopeKind: "restaurant",
			restaurantId,
			name: "First",
			config: baseConfig,
		});
		if (!originalId) throw new Error("original creation failed");

		const [duplicatedId, dupErr] = await user.mutation(api.dashboardLayouts.duplicate, {
			layoutId: originalId,
		});
		expect(dupErr).toBeNull();
		expect(duplicatedId).toBeTruthy();
		expect(duplicatedId).not.toBe(originalId);

		const [rows] = await user.query(api.dashboardLayouts.list, {
			scopeKind: "restaurant",
			restaurantId,
		});
		expect(rows).toHaveLength(2);
		expect(rows?.[0]?.position).toBe(0);
		expect(rows?.[1]?.position).toBe(1);
		expect(rows?.[1]?.name).toBe("First (copy)");
	});

	it("reorder updates positions for the user's layouts", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		await seedMembership(t, {
			userId: "staff1",
			restaurantId,
			orgId,
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
		});

		const user = t.withIdentity({ subject: "staff1" });
		const ids: Id<"dashboardLayouts">[] = [];
		for (const name of ["A", "B", "C"]) {
			const [id] = await user.mutation(api.dashboardLayouts.create, {
				scopeKind: "restaurant",
				restaurantId,
				name,
				config: baseConfig,
			});
			if (!id) throw new Error(`creation for ${name} failed`);
			ids.push(id);
		}

		const [, reorderErr] = await user.mutation(api.dashboardLayouts.reorder, {
			scopeKind: "restaurant",
			restaurantId,
			orderedIds: [ids[2], ids[0], ids[1]],
		});
		expect(reorderErr).toBeNull();

		const [rows] = await user.query(api.dashboardLayouts.list, {
			scopeKind: "restaurant",
			restaurantId,
		});
		const orderedNames = (rows ?? []).map((r) => r.name);
		expect(orderedNames).toEqual(["C", "A", "B"]);
	});
});
