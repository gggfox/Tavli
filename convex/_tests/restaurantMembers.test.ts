import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE, USER_ROLES } from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

async function seedOrgAndRestaurant(t: ReturnType<typeof convexTest>): Promise<{
	orgId: Id<"organizations">;
	restaurantId: Id<"restaurants">;
}> {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const orgId = await ctx.db.insert("organizations", {
			name: "Members Test Org",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const restaurantId = await ctx.db.insert("restaurants", {
			ownerId: "seed-owner",
			organizationId: orgId,
			name: "R1",
			slug: "members-test-r1",
			currency: "USD",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		return { orgId, restaurantId };
	});
}

async function seedUserRole(
	t: ReturnType<typeof convexTest>,
	args: { userId: string; roles: string[]; organizationId?: Id<"organizations">; email?: string }
) {
	await t.run(async (ctx) => {
		await ctx.db.insert("userRoles", {
			userId: args.userId,
			email: args.email,
			roles: args.roles as Array<"admin" | "owner" | "manager" | "customer" | "employee">,
			organizationId: args.organizationId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
}

describe("restaurantMembers listOrganizationUsersForRestaurant", () => {
	it("returns org directory for org owner", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		await seedUserRole(t, {
			userId: "owner1",
			roles: [USER_ROLES.OWNER],
			organizationId: orgId,
		});
		await seedUserRole(t, {
			userId: "emp1",
			roles: [USER_ROLES.EMPLOYEE],
			organizationId: orgId,
			email: "emp1@example.com",
		});

		const authed = t.withIdentity({ subject: "owner1" });
		const [rows, err] = await authed.query(api.restaurantMembers.listOrganizationUsersForRestaurant, {
			restaurantId,
		});

		expect(err).toBeNull();
		expect(Array.isArray(rows)).toBe(true);
		const list = rows as Array<{ userId: string; email: string | null }>;
		expect(list).toHaveLength(2);
		const ids = new Set(list.map((r) => r.userId));
		expect(ids.has("owner1")).toBe(true);
		expect(ids.has("emp1")).toBe(true);
	});

	it("allows restaurants.ownerId without org owner role or restaurant member row", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId } = await seedOrgAndRestaurant(t);
		await seedUserRole(t, {
			userId: "seed-owner",
			roles: [USER_ROLES.MANAGER],
			organizationId: undefined,
		});

		const authed = t.withIdentity({ subject: "seed-owner" });
		const [rows, err] = await authed.query(api.restaurantMembers.listTeamDirectory, {
			restaurantId,
		});

		expect(err).toBeNull();
		if (!Array.isArray(rows)) throw new Error("expected directory rows");
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			rowType: "restaurantOwner",
			userId: "seed-owner",
			role: USER_ROLES.OWNER,
			isActive: true,
		});
	});

	it("listTeamDirectory includes org owner not in restaurantMembers and dedupes document owner", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		await seedUserRole(t, {
			userId: "seed-owner",
			roles: [USER_ROLES.MANAGER],
			organizationId: undefined,
		});
		await seedUserRole(t, {
			userId: "org-owner-2",
			roles: [USER_ROLES.OWNER],
			organizationId: orgId,
			email: "org2@example.com",
		});

		const authed = t.withIdentity({ subject: "seed-owner" });
		const [rows, err] = await authed.query(api.restaurantMembers.listTeamDirectory, {
			restaurantId,
		});

		expect(err).toBeNull();
		const types = (rows as Array<{ rowType: string; userId?: string }>).map((r) => r.rowType);
		expect(types.filter((x) => x === "restaurantOwner")).toHaveLength(1);
		expect(types.filter((x) => x === "orgOwner")).toHaveLength(1);
		const orgOwnerRow = (rows as Array<{ rowType: string; userId: string }>).find((r) => r.rowType === "orgOwner");
		expect(orgOwnerRow?.userId).toBe("org-owner-2");
	});

	it("listTeamDirectory skips restaurantOwner when owner already has a member row", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		await seedUserRole(t, {
			userId: "seed-owner",
			roles: [USER_ROLES.MANAGER],
			organizationId: undefined,
		});
		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert("restaurantMembers", {
				userId: "seed-owner",
				restaurantId,
				organizationId: orgId,
				role: RESTAURANT_MEMBER_ROLE.MANAGER,
				isActive: true,
				createdAt: now,
				updatedAt: now,
			});
		});

		const authed = t.withIdentity({ subject: "seed-owner" });
		const [rows, err] = await authed.query(api.restaurantMembers.listTeamDirectory, {
			restaurantId,
		});

		expect(err).toBeNull();
		if (!Array.isArray(rows)) throw new Error("expected directory rows");
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			rowType: "member",
			userId: "seed-owner",
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
		});
	});

	it("listTeamDirectory omits orgOwner synthetic for admin-only user without owner role", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		await seedUserRole(t, {
			userId: "seed-owner",
			roles: [USER_ROLES.MANAGER],
			organizationId: undefined,
		});
		await seedUserRole(t, {
			userId: "admin-only",
			roles: [USER_ROLES.ADMIN],
			organizationId: orgId,
			email: "admin@example.com",
		});

		const authed = t.withIdentity({ subject: "seed-owner" });
		const [rows, err] = await authed.query(api.restaurantMembers.listTeamDirectory, {
			restaurantId,
		});

		expect(err).toBeNull();
		const userIds = (rows as Array<{ userId?: string }>).map((r) => r.userId).filter(Boolean);
		expect(userIds).not.toContain("admin-only");
	});

	it("listTeamDirectory still lists member row for user with only admin in userRoles", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		await seedUserRole(t, {
			userId: "seed-owner",
			roles: [USER_ROLES.MANAGER],
			organizationId: undefined,
		});
		await seedUserRole(t, {
			userId: "admin-emp",
			roles: [USER_ROLES.ADMIN],
			organizationId: orgId,
		});
		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert("restaurantMembers", {
				userId: "admin-emp",
				restaurantId,
				organizationId: orgId,
				role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
				isActive: true,
				createdAt: now,
				updatedAt: now,
			});
		});

		const authed = t.withIdentity({ subject: "seed-owner" });
		const [rows, err] = await authed.query(api.restaurantMembers.listTeamDirectory, {
			restaurantId,
		});

		expect(err).toBeNull();
		const memberIds = (rows as Array<{ rowType: string; userId?: string }>)
			.filter((r) => r.rowType === "member")
			.map((r) => r.userId);
		expect(memberIds).toContain("admin-emp");
	});

	it("denies restaurant-scoped manager", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		await seedUserRole(t, {
			userId: "locMgr",
			roles: [USER_ROLES.EMPLOYEE],
			organizationId: orgId,
		});
		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert("restaurantMembers", {
				userId: "locMgr",
				restaurantId,
				organizationId: orgId,
				role: RESTAURANT_MEMBER_ROLE.MANAGER,
				isActive: true,
				createdAt: now,
				updatedAt: now,
			});
		});

		const authed = t.withIdentity({ subject: "locMgr" });
		const [rows, err] = await authed.query(api.restaurantMembers.listOrganizationUsersForRestaurant, {
			restaurantId,
		});

		expect(rows).toBeNull();
		expect(err).toMatchObject({ name: "NOT_AUTHORIZED" });
	});
});

describe("restaurantMembers addMember reactivate", () => {
	it("reactivates inactive membership with new role", async () => {
		const t = convexTest(schema, modules);
		const { orgId, restaurantId } = await seedOrgAndRestaurant(t);
		await seedUserRole(t, {
			userId: "owner1",
			roles: [USER_ROLES.OWNER],
			organizationId: orgId,
		});
		await seedUserRole(t, {
			userId: "u1",
			roles: [USER_ROLES.EMPLOYEE],
			organizationId: orgId,
		});

		const memberId = await t.run(async (ctx) => {
			const now = Date.now();
			return await ctx.db.insert("restaurantMembers", {
				userId: "u1",
				restaurantId,
				organizationId: orgId,
				role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
				isActive: false,
				createdAt: now,
				updatedAt: now,
			});
		});

		const authed = t.withIdentity({ subject: "owner1" });
		const [id, err] = await authed.mutation(api.restaurantMembers.addMember, {
			restaurantId,
			userId: "u1",
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
		});

		expect(err).toBeNull();
		expect(id).toBe(memberId);

		const row = await t.run(async (ctx) => ctx.db.get(memberId));
		expect(row?.isActive).toBe(true);
		expect(row?.role).toBe(RESTAURANT_MEMBER_ROLE.MANAGER);
	});
});
