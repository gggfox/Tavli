import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE, USER_ROLES } from "../constants";
import { insertMenuForRestaurant } from "../menus";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

async function seedOrgAndRestaurants(t: ReturnType<typeof convexTest>): Promise<{
	orgId: Id<"organizations">;
	r1: Id<"restaurants">;
	r2: Id<"restaurants">;
}> {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const orgId = await ctx.db.insert("organizations", {
			name: "Invite Org",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const r1 = await ctx.db.insert("restaurants", {
			ownerId: "seed-owner",
			organizationId: orgId,
			name: "R1",
			slug: "invite-r1",
			currency: "USD",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		await insertMenuForRestaurant(ctx, {
			restaurantId: r1,
			name: "invite-r1",
			userId: "seed-owner",
		});
		const r2 = await ctx.db.insert("restaurants", {
			ownerId: "seed-owner",
			organizationId: orgId,
			name: "R2",
			slug: "invite-r2",
			currency: "USD",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		await insertMenuForRestaurant(ctx, {
			restaurantId: r2,
			name: "invite-r2",
			userId: "seed-owner",
		});
		return { orgId, r1, r2 };
	});
}

async function seedUserRole(
	t: ReturnType<typeof convexTest>,
	args: { userId: string; roles: string[]; organizationId?: Id<"organizations"> }
) {
	await t.run(async (ctx) => {
		await ctx.db.insert("userRoles", {
			userId: args.userId,
			roles: args.roles as Array<"admin" | "owner" | "manager" | "customer" | "employee">,
			organizationId: args.organizationId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
}

async function seedManagerMembership(
	t: ReturnType<typeof convexTest>,
	args: {
		userId: string;
		restaurantId: Id<"restaurants">;
		organizationId: Id<"organizations">;
	}
) {
	await t.run(async (ctx) => {
		const now = Date.now();
		await ctx.db.insert("restaurantMembers", {
			userId: args.userId,
			restaurantId: args.restaurantId,
			organizationId: args.organizationId,
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
	});
}

describe("invites createInvitation", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("allows admin to invite organization owner with empty restaurantIds", async () => {
		const t = convexTest(schema, modules);
		const { orgId } = await seedOrgAndRestaurants(t);
		await seedUserRole(t, { userId: "admin1", roles: [USER_ROLES.ADMIN] });
		const authed = t.withIdentity({ subject: "admin1" });

		const [id, error] = await authed.mutation(api.invites.createInvitation, {
			organizationId: orgId,
			email: "new-owner@example.com",
			role: USER_ROLES.OWNER,
			restaurantIds: [],
		});

		expect(error).toBeNull();
		expect(id).toBeTruthy();
		await t.finishAllScheduledFunctions(() => {
			vi.runAllTimers();
		});
	});

	it("denies org owner inviting another org owner", async () => {
		const t = convexTest(schema, modules);
		const { orgId } = await seedOrgAndRestaurants(t);
		await seedUserRole(t, { userId: "owner1", roles: [USER_ROLES.OWNER], organizationId: orgId });
		const authed = t.withIdentity({ subject: "owner1" });

		const [id, error] = await authed.mutation(api.invites.createInvitation, {
			organizationId: orgId,
			email: "co-owner@example.com",
			role: USER_ROLES.OWNER,
			restaurantIds: [],
		});

		expect(id).toBeNull();
		expect(error?.name).toBe("NOT_AUTHORIZED");
	});

	it("allows org owner to invite manager with at least one restaurant", async () => {
		const t = convexTest(schema, modules);
		const { orgId, r1 } = await seedOrgAndRestaurants(t);
		await seedUserRole(t, { userId: "owner1", roles: [USER_ROLES.OWNER], organizationId: orgId });
		const authed = t.withIdentity({ subject: "owner1" });

		const [id, error] = await authed.mutation(api.invites.createInvitation, {
			organizationId: orgId,
			email: "mgr@example.com",
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
			restaurantIds: [r1],
		});

		expect(error).toBeNull();
		expect(id).toBeTruthy();
		await t.finishAllScheduledFunctions(() => {
			vi.runAllTimers();
		});
	});

	it("allows org owner to invite employee with restaurants", async () => {
		const t = convexTest(schema, modules);
		const { orgId, r1 } = await seedOrgAndRestaurants(t);
		await seedUserRole(t, { userId: "owner1", roles: [USER_ROLES.OWNER], organizationId: orgId });
		const authed = t.withIdentity({ subject: "owner1" });

		const [id, error] = await authed.mutation(api.invites.createInvitation, {
			organizationId: orgId,
			email: "emp@example.com",
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
			restaurantIds: [r1],
		});

		expect(error).toBeNull();
		expect(id).toBeTruthy();
		await t.finishAllScheduledFunctions(() => {
			vi.runAllTimers();
		});
	});

	it("denies restaurant manager inviting owner or manager", async () => {
		const t = convexTest(schema, modules);
		const { orgId, r1 } = await seedOrgAndRestaurants(t);
		await seedManagerMembership(t, {
			userId: "mgrOnly",
			restaurantId: r1,
			organizationId: orgId,
		});
		const authed = t.withIdentity({ subject: "mgrOnly" });

		const [idOwner, errOwner] = await authed.mutation(api.invites.createInvitation, {
			organizationId: orgId,
			email: "x@example.com",
			role: USER_ROLES.OWNER,
			restaurantIds: [],
		});
		expect(idOwner).toBeNull();
		expect(errOwner?.name).toBe("NOT_AUTHORIZED");

		const [idMgr, errMgr] = await authed.mutation(api.invites.createInvitation, {
			organizationId: orgId,
			email: "y@example.com",
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
			restaurantIds: [r1],
		});
		expect(idMgr).toBeNull();
		expect(errMgr?.name).toBe("NOT_AUTHORIZED");
	});

	it("allows restaurant manager to invite employee for restaurants they manage", async () => {
		const t = convexTest(schema, modules);
		const { orgId, r1 } = await seedOrgAndRestaurants(t);
		await seedManagerMembership(t, {
			userId: "mgrOnly",
			restaurantId: r1,
			organizationId: orgId,
		});
		const authed = t.withIdentity({ subject: "mgrOnly" });

		const [id, error] = await authed.mutation(api.invites.createInvitation, {
			organizationId: orgId,
			email: "newemp@example.com",
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
			restaurantIds: [r1],
		});

		expect(error).toBeNull();
		expect(id).toBeTruthy();
		await t.finishAllScheduledFunctions(() => {
			vi.runAllTimers();
		});
	});

	it("denies restaurant manager employee invite when not manager on every selected restaurant", async () => {
		const t = convexTest(schema, modules);
		const { orgId, r1, r2 } = await seedOrgAndRestaurants(t);
		await seedManagerMembership(t, {
			userId: "mgrOnly",
			restaurantId: r1,
			organizationId: orgId,
		});
		const authed = t.withIdentity({ subject: "mgrOnly" });

		const [id, error] = await authed.mutation(api.invites.createInvitation, {
			organizationId: orgId,
			email: "emp2@example.com",
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
			restaurantIds: [r1, r2],
		});

		expect(id).toBeNull();
		expect(error?.name).toBe("NOT_AUTHORIZED");
	});

	it("allows org-level manager to invite employee across any org restaurants", async () => {
		const t = convexTest(schema, modules);
		const { orgId, r1, r2 } = await seedOrgAndRestaurants(t);
		await seedUserRole(t, {
			userId: "orgMgr",
			roles: [USER_ROLES.MANAGER],
			organizationId: orgId,
		});
		const authed = t.withIdentity({ subject: "orgMgr" });

		const [id, error] = await authed.mutation(api.invites.createInvitation, {
			organizationId: orgId,
			email: "emp3@example.com",
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
			restaurantIds: [r1, r2],
		});

		expect(error).toBeNull();
		expect(id).toBeTruthy();
		await t.finishAllScheduledFunctions(() => {
			vi.runAllTimers();
		});
	});

	it("denies org-level manager inviting manager or owner", async () => {
		const t = convexTest(schema, modules);
		const { orgId, r1 } = await seedOrgAndRestaurants(t);
		await seedUserRole(t, {
			userId: "orgMgr",
			roles: [USER_ROLES.MANAGER],
			organizationId: orgId,
		});
		const authed = t.withIdentity({ subject: "orgMgr" });

		const [idMgr, errMgr] = await authed.mutation(api.invites.createInvitation, {
			organizationId: orgId,
			email: "newmgr@example.com",
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
			restaurantIds: [r1],
		});
		expect(idMgr).toBeNull();
		expect(errMgr?.name).toBe("NOT_AUTHORIZED");

		const [idOwner, errOwner] = await authed.mutation(api.invites.createInvitation, {
			organizationId: orgId,
			email: "newowner@example.com",
			role: USER_ROLES.OWNER,
			restaurantIds: [],
		});
		expect(idOwner).toBeNull();
		expect(errOwner?.name).toBe("NOT_AUTHORIZED");
	});

	it("denies org-level manager inviting employee for a different organization", async () => {
		const t = convexTest(schema, modules);
		const { orgId, r1 } = await seedOrgAndRestaurants(t);
		const otherOrgId = await t.run(async (ctx) => {
			const now = Date.now();
			return ctx.db.insert("organizations", {
				name: "Other Org",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			});
		});
		await seedUserRole(t, {
			userId: "orgMgr",
			roles: [USER_ROLES.MANAGER],
			organizationId: otherOrgId,
		});
		const authed = t.withIdentity({ subject: "orgMgr" });

		const [id, error] = await authed.mutation(api.invites.createInvitation, {
			organizationId: orgId,
			email: "emp@example.com",
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
			restaurantIds: [r1],
		});

		expect(id).toBeNull();
		expect(error?.name).toBe("NOT_AUTHORIZED");
	});
});

describe("invites revokeInvitation", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("allows org-level manager to revoke an employee invitation", async () => {
		const t = convexTest(schema, modules);
		const { orgId, r1 } = await seedOrgAndRestaurants(t);
		await seedUserRole(t, { userId: "owner1", roles: [USER_ROLES.OWNER], organizationId: orgId });
		await seedUserRole(t, {
			userId: "orgMgr",
			roles: [USER_ROLES.MANAGER],
			organizationId: orgId,
		});

		const ownerAuthed = t.withIdentity({ subject: "owner1" });
		const [inviteId] = await ownerAuthed.mutation(api.invites.createInvitation, {
			organizationId: orgId,
			email: "revoke-me@example.com",
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
			restaurantIds: [r1],
		});
		expect(inviteId).toBeTruthy();

		const mgrAuthed = t.withIdentity({ subject: "orgMgr" });
		const [, err] = await mgrAuthed.mutation(api.invites.revokeInvitation, {
			invitationId: inviteId!,
		});
		expect(err).toBeNull();
	});

	it("allows restaurant manager to revoke an employee invitation they could create", async () => {
		const t = convexTest(schema, modules);
		const { orgId, r1 } = await seedOrgAndRestaurants(t);
		await seedManagerMembership(t, {
			userId: "mgrOnly",
			restaurantId: r1,
			organizationId: orgId,
		});
		const mgrAuthed = t.withIdentity({ subject: "mgrOnly" });

		const [inviteId, createErr] = await mgrAuthed.mutation(api.invites.createInvitation, {
			organizationId: orgId,
			email: "revoke-rm@example.com",
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
			restaurantIds: [r1],
		});
		expect(createErr).toBeNull();
		expect(inviteId).toBeTruthy();

		const [, revokeErr] = await mgrAuthed.mutation(api.invites.revokeInvitation, {
			invitationId: inviteId!,
		});
		expect(revokeErr).toBeNull();
	});

	it("denies restaurant manager revoking employee invite spanning an unmanaged restaurant", async () => {
		const t = convexTest(schema, modules);
		const { orgId, r1, r2 } = await seedOrgAndRestaurants(t);
		await seedUserRole(t, { userId: "owner1", roles: [USER_ROLES.OWNER], organizationId: orgId });
		await seedManagerMembership(t, {
			userId: "mgrOnly",
			restaurantId: r1,
			organizationId: orgId,
		});

		const ownerAuthed = t.withIdentity({ subject: "owner1" });
		const [inviteId] = await ownerAuthed.mutation(api.invites.createInvitation, {
			organizationId: orgId,
			email: "two-sites@example.com",
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
			restaurantIds: [r1, r2],
		});
		expect(inviteId).toBeTruthy();

		const mgrAuthed = t.withIdentity({ subject: "mgrOnly" });
		const [, revokeErr] = await mgrAuthed.mutation(api.invites.revokeInvitation, {
			invitationId: inviteId!,
		});
		expect(revokeErr?.name).toBe("NOT_AUTHORIZED");
	});

	it("denies org-level manager revoking a manager invitation", async () => {
		const t = convexTest(schema, modules);
		const { orgId, r1 } = await seedOrgAndRestaurants(t);
		await seedUserRole(t, { userId: "owner1", roles: [USER_ROLES.OWNER], organizationId: orgId });
		await seedUserRole(t, {
			userId: "orgMgr",
			roles: [USER_ROLES.MANAGER],
			organizationId: orgId,
		});

		const ownerAuthed = t.withIdentity({ subject: "owner1" });
		const [inviteId] = await ownerAuthed.mutation(api.invites.createInvitation, {
			organizationId: orgId,
			email: "mgr-inv@example.com",
			role: RESTAURANT_MEMBER_ROLE.MANAGER,
			restaurantIds: [r1],
		});
		expect(inviteId).toBeTruthy();

		const mgrAuthed = t.withIdentity({ subject: "orgMgr" });
		const [, revokeErr] = await mgrAuthed.mutation(api.invites.revokeInvitation, {
			invitationId: inviteId!,
		});
		expect(revokeErr?.name).toBe("NOT_AUTHORIZED");
	});
});

describe("restaurantMembers listTeamDirectory", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns members and pending invites visible for a restaurant manager", async () => {
		const t = convexTest(schema, modules);
		const { orgId, r1 } = await seedOrgAndRestaurants(t);
		await seedManagerMembership(t, {
			userId: "mgrOnly",
			restaurantId: r1,
			organizationId: orgId,
		});

		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert("restaurantMembers", {
				userId: "empUser",
				restaurantId: r1,
				organizationId: orgId,
				role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
				isActive: true,
				createdAt: now,
				updatedAt: now,
			});
		});

		const mgrAuthed = t.withIdentity({ subject: "mgrOnly" });
		const [inviteId, createErr] = await mgrAuthed.mutation(api.invites.createInvitation, {
			organizationId: orgId,
			email: "pending@example.com",
			role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
			restaurantIds: [r1],
		});
		expect(createErr).toBeNull();
		expect(inviteId).toBeTruthy();

		const [rows, qErr] = await mgrAuthed.query(api.restaurantMembers.listTeamDirectory, {
			restaurantId: r1,
		});
		expect(qErr).toBeNull();
		if (!Array.isArray(rows)) throw new Error("expected directory rows");
		// Document owner (synthetic) + restaurant manager + seeded employee + pending invite
		expect(rows.length).toBe(4);
		const kinds = new Set(rows.map((r) => r.rowType));
		expect(kinds.has("member")).toBe(true);
		expect(kinds.has("invite")).toBe(true);
		expect(kinds.has("restaurantOwner")).toBe(true);
		const inviteRow = rows.find((r) => r.rowType === "invite");
		expect(inviteRow && "email" in inviteRow && inviteRow.email).toBe("pending@example.com");
	});

	it("omits pending owner invite for restaurant manager", async () => {
		const t = convexTest(schema, modules);
		const { orgId, r1 } = await seedOrgAndRestaurants(t);
		await seedUserRole(t, { userId: "admin1", roles: [USER_ROLES.ADMIN] });
		await seedManagerMembership(t, {
			userId: "mgrOnly",
			restaurantId: r1,
			organizationId: orgId,
		});

		const adminAuthed = t.withIdentity({ subject: "admin1" });
		await adminAuthed.mutation(api.invites.createInvitation, {
			organizationId: orgId,
			email: "owner-inv@example.com",
			role: USER_ROLES.OWNER,
			restaurantIds: [],
		});

		const mgrAuthed = t.withIdentity({ subject: "mgrOnly" });
		const [rows, qErr] = await mgrAuthed.query(api.restaurantMembers.listTeamDirectory, {
			restaurantId: r1,
		});
		expect(qErr).toBeNull();
		if (!Array.isArray(rows)) throw new Error("expected directory rows");
		const ownerInvite = rows.filter((r) => r.rowType === "invite" && r.email === "owner-inv@example.com");
		expect(ownerInvite?.length).toBe(0);
	});

	it("includes pending owner invite for org owner", async () => {
		const t = convexTest(schema, modules);
		const { orgId, r1 } = await seedOrgAndRestaurants(t);
		await seedUserRole(t, { userId: "admin1", roles: [USER_ROLES.ADMIN] });
		await seedUserRole(t, { userId: "owner1", roles: [USER_ROLES.OWNER], organizationId: orgId });

		const adminAuthed = t.withIdentity({ subject: "admin1" });
		await adminAuthed.mutation(api.invites.createInvitation, {
			organizationId: orgId,
			email: "owner-inv2@example.com",
			role: USER_ROLES.OWNER,
			restaurantIds: [],
		});

		const ownerAuthed = t.withIdentity({ subject: "owner1" });
		const [rows, qErr] = await ownerAuthed.query(api.restaurantMembers.listTeamDirectory, {
			restaurantId: r1,
		});
		expect(qErr).toBeNull();
		if (!Array.isArray(rows)) throw new Error("expected directory rows");
		const hit = rows.find((r) => r.rowType === "invite" && r.email === "owner-inv2@example.com");
		expect(hit).toBeTruthy();
	});
});
