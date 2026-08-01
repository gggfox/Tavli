// node:buffer's Blob implements arrayBuffer(), which jsdom's Blob lacks and
// convex-test's storage.store needs.
import { Blob as NodeBlob } from "node:buffer";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { TABLE, USER_ROLES, type UserRole } from "./constants";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type Tester = ReturnType<typeof convexTest>;

async function seedOrg(t: Tester, name: string): Promise<Id<"organizations">> {
	return await t.run(async (ctx) => {
		const now = Date.now();
		return await ctx.db.insert(TABLE.ORGANIZATIONS, {
			name,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
	});
}

async function seedUserRole(
	t: Tester,
	opts: { userId: string; roles: UserRole[]; organizationId?: string }
): Promise<Id<"userRoles">> {
	return await t.run(async (ctx) => {
		const now = Date.now();
		return await ctx.db.insert(TABLE.USER_ROLES, {
			userId: opts.userId,
			roles: opts.roles,
			...(opts.organizationId !== undefined && { organizationId: opts.organizationId }),
			createdAt: now,
			updatedAt: now,
		});
	});
}

async function newStorageId(t: Tester): Promise<Id<"_storage">> {
	return await t.run(async (ctx) => await ctx.storage.store(new NodeBlob(["photo-bytes"]) as Blob));
}

async function getUserRoleRow(t: Tester, userId: string) {
	return await t.run(async (ctx) => {
		const rows = await ctx.db.query(TABLE.USER_ROLES).collect();
		return rows.find((r) => r.userId === userId) ?? null;
	});
}

describe("setUserPhoto", () => {
	it("lets a user set their own photo without targetUserId", async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t, "Org A");
		await seedUserRole(t, { userId: "me", roles: [USER_ROLES.EMPLOYEE], organizationId: orgId });
		const storageId = await newStorageId(t);

		await t
			.withIdentity({ subject: "me" })
			.mutation(api.userSettings.setUserPhoto, { photoStorageId: storageId });

		const row = await getUserRoleRow(t, "me");
		expect(row?.photoStorageId).toBe(storageId);
		expect(row?.updatedBy).toBe("me");
	});

	it("treats targetUserId equal to the actor as self-service", async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t, "Org A");
		await seedUserRole(t, { userId: "me", roles: [USER_ROLES.EMPLOYEE], organizationId: orgId });
		const storageId = await newStorageId(t);

		await t
			.withIdentity({ subject: "me" })
			.mutation(api.userSettings.setUserPhoto, { photoStorageId: storageId, targetUserId: "me" });

		const row = await getUserRoleRow(t, "me");
		expect(row?.photoStorageId).toBe(storageId);
	});

	it("rejects a role-less authenticated user targeting another user", async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t, "Org A");
		await seedUserRole(t, {
			userId: "victim",
			roles: [USER_ROLES.EMPLOYEE],
			organizationId: orgId,
		});
		const storageId = await newStorageId(t);

		await expect(
			t.withIdentity({ subject: "attacker" }).mutation(api.userSettings.setUserPhoto, {
				photoStorageId: storageId,
				targetUserId: "victim",
			})
		).rejects.toThrow(/ERROR_OWNER_ROLE_REQUIRED/);

		const row = await getUserRoleRow(t, "victim");
		expect(row?.photoStorageId).toBeUndefined();
	});

	it("rejects a manager targeting another user in the same org", async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t, "Org A");
		await seedUserRole(t, {
			userId: "manager",
			roles: [USER_ROLES.MANAGER],
			organizationId: orgId,
		});
		await seedUserRole(t, {
			userId: "victim",
			roles: [USER_ROLES.EMPLOYEE],
			organizationId: orgId,
		});
		const storageId = await newStorageId(t);

		await expect(
			t.withIdentity({ subject: "manager" }).mutation(api.userSettings.setUserPhoto, {
				photoStorageId: storageId,
				targetUserId: "victim",
			})
		).rejects.toThrow(/ERROR_OWNER_ROLE_REQUIRED/);
	});

	it("rejects an org owner targeting a user in a different org", async () => {
		const t = convexTest(schema, modules);
		const orgA = await seedOrg(t, "Org A");
		const orgB = await seedOrg(t, "Org B");
		await seedUserRole(t, { userId: "ownerB", roles: [USER_ROLES.OWNER], organizationId: orgB });
		await seedUserRole(t, {
			userId: "victim",
			roles: [USER_ROLES.EMPLOYEE],
			organizationId: orgA,
		});
		const storageId = await newStorageId(t);

		await expect(
			t.withIdentity({ subject: "ownerB" }).mutation(api.userSettings.setUserPhoto, {
				photoStorageId: storageId,
				targetUserId: "victim",
			})
		).rejects.toThrow(/ERROR_OWNER_ROLE_REQUIRED/);
	});

	it("rejects targeting a user with no userRoles row instead of silently succeeding", async () => {
		const t = convexTest(schema, modules);
		const storageId = await newStorageId(t);

		await expect(
			t.withIdentity({ subject: "attacker" }).mutation(api.userSettings.setUserPhoto, {
				photoStorageId: storageId,
				targetUserId: "ghost",
			})
		).rejects.toThrow(/ERROR_OWNER_ROLE_REQUIRED/);
	});

	it("allows an org owner to set a photo for a user in their org", async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t, "Org A");
		await seedUserRole(t, { userId: "owner", roles: [USER_ROLES.OWNER], organizationId: orgId });
		await seedUserRole(t, {
			userId: "member",
			roles: [USER_ROLES.EMPLOYEE],
			organizationId: orgId,
		});
		const storageId = await newStorageId(t);

		await t.withIdentity({ subject: "owner" }).mutation(api.userSettings.setUserPhoto, {
			photoStorageId: storageId,
			targetUserId: "member",
		});

		const row = await getUserRoleRow(t, "member");
		expect(row?.photoStorageId).toBe(storageId);
		expect(row?.updatedBy).toBe("owner");
	});

	it("allows an admin to set any user's photo", async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t, "Org A");
		await seedUserRole(t, { userId: "admin", roles: [USER_ROLES.ADMIN] });
		await seedUserRole(t, {
			userId: "member",
			roles: [USER_ROLES.EMPLOYEE],
			organizationId: orgId,
		});
		const storageId = await newStorageId(t);

		await t.withIdentity({ subject: "admin" }).mutation(api.userSettings.setUserPhoto, {
			photoStorageId: storageId,
			targetUserId: "member",
		});

		const row = await getUserRoleRow(t, "member");
		expect(row?.photoStorageId).toBe(storageId);
	});
});
