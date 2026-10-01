import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { USER_ROLES } from "../constants";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

async function seedOrganization(t: ReturnType<typeof convexTest>, name: string) {
	let orgId: Id<"organizations">;
	await t.run(async (ctx) => {
		orgId = await ctx.db.insert("organizations", {
			name,
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return orgId!;
}

async function seedUserRole(
	t: ReturnType<typeof convexTest>,
	args: { userId: string; roles: string[]; organizationId?: string }
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

/**
 * TAVLI-71 item 8: the organization directory is tiered, not admin-only. An
 * owner-but-not-admin is offered the "New Restaurant" button and is allowed to
 * run `restaurants.create`, so they must also be able to read the organization
 * list this form requires -- scoped to their own organization(s).
 */
describe("organizations.getAllOrganizations", () => {
	it("returns every organization for an admin", async () => {
		const t = convexTest(schema, modules);
		await seedOrganization(t, "Org A");
		await seedOrganization(t, "Org B");
		await seedUserRole(t, { userId: "admin1", roles: [USER_ROLES.ADMIN] });

		const [orgs, error] = await t
			.withIdentity({ subject: "admin1" })
			.query(api.organizations.getAllOrganizations, {});

		expect(error).toBeNull();
		expect(orgs!.map((o) => o.name).sort()).toEqual(["Org A", "Org B"]);
	});

	it("returns only the owner's own organization for an owner", async () => {
		const t = convexTest(schema, modules);
		const mine = await seedOrganization(t, "Mine");
		await seedOrganization(t, "Someone Else");
		await seedUserRole(t, {
			userId: "owner1",
			roles: [USER_ROLES.OWNER],
			organizationId: mine,
		});

		const [orgs, error] = await t
			.withIdentity({ subject: "owner1" })
			.query(api.organizations.getAllOrganizations, {});

		expect(error).toBeNull();
		expect(orgs).toHaveLength(1);
		expect(orgs![0]._id).toBe(mine);
	});

	it("returns every organization an owner holds a role row for, de-duplicated", async () => {
		const t = convexTest(schema, modules);
		const first = await seedOrganization(t, "First");
		const second = await seedOrganization(t, "Second");
		await seedOrganization(t, "Not Theirs");
		await seedUserRole(t, {
			userId: "owner2",
			roles: [USER_ROLES.OWNER],
			organizationId: first,
		});
		await seedUserRole(t, {
			userId: "owner2",
			roles: [USER_ROLES.OWNER],
			organizationId: second,
		});
		await seedUserRole(t, {
			userId: "owner2",
			roles: [USER_ROLES.OWNER],
			organizationId: second,
		});

		const [orgs, error] = await t
			.withIdentity({ subject: "owner2" })
			.query(api.organizations.getAllOrganizations, {});

		expect(error).toBeNull();
		expect(orgs!.map((o) => o.name).sort()).toEqual(["First", "Second"]);
	});

	it("returns an empty list -- not an error -- for an owner with no organization", async () => {
		const t = convexTest(schema, modules);
		await seedOrganization(t, "Org A");
		await seedUserRole(t, { userId: "owner3", roles: [USER_ROLES.OWNER] });

		const [orgs, error] = await t
			.withIdentity({ subject: "owner3" })
			.query(api.organizations.getAllOrganizations, {});

		expect(error).toBeNull();
		expect(orgs).toEqual([]);
	});

	it("skips a stale organizationId instead of throwing", async () => {
		const t = convexTest(schema, modules);
		const real = await seedOrganization(t, "Real");
		await seedUserRole(t, {
			userId: "owner4",
			roles: [USER_ROLES.OWNER],
			organizationId: "not-a-convex-id",
		});
		await seedUserRole(t, {
			userId: "owner4",
			roles: [USER_ROLES.OWNER],
			organizationId: real,
		});

		const [orgs, error] = await t
			.withIdentity({ subject: "owner4" })
			.query(api.organizations.getAllOrganizations, {});

		expect(error).toBeNull();
		expect(orgs!.map((o) => o.name)).toEqual(["Real"]);
	});

	it("rejects a manager", async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrganization(t, "Org A");
		await seedUserRole(t, {
			userId: "manager1",
			roles: [USER_ROLES.MANAGER],
			organizationId: orgId,
		});

		const [orgs, error] = await t
			.withIdentity({ subject: "manager1" })
			.query(api.organizations.getAllOrganizations, {});

		expect(orgs).toBeNull();
		expect(error!.name).toBe("NOT_AUTHORIZED");
		expect(error!.message).toBe("ERROR_OWNER_ROLE_REQUIRED");
	});

	it("rejects an employee", async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrganization(t, "Org A");
		await seedUserRole(t, {
			userId: "employee1",
			roles: [USER_ROLES.EMPLOYEE],
			organizationId: orgId,
		});

		const [orgs, error] = await t
			.withIdentity({ subject: "employee1" })
			.query(api.organizations.getAllOrganizations, {});

		expect(orgs).toBeNull();
		expect(error!.name).toBe("NOT_AUTHORIZED");
	});

	it("rejects an unauthenticated caller", async () => {
		const t = convexTest(schema, modules);
		await seedOrganization(t, "Org A");

		const [orgs, error] = await t.query(api.organizations.getAllOrganizations, {});

		expect(orgs).toBeNull();
		expect(error!.name).toBe("NOT_AUTHENTICATED");
	});
});

/**
 * The organization functions refuse with stable codes the frontend localizes,
 * never English prose. Validation failures keep the field they belong to, and
 * the delete refusal carries how many users are still assigned.
 */
describe("organizations error codes", () => {
	async function seedAdmin(t: ReturnType<typeof convexTest>) {
		await seedUserRole(t, { userId: "admin1", roles: [USER_ROLES.ADMIN] });
		return t.withIdentity({ subject: "admin1" });
	}

	it("refuses a blank or duplicate name on create", async () => {
		const t = convexTest(schema, modules);
		const admin = await seedAdmin(t);
		await seedOrganization(t, "Taken");

		const [, blank] = await admin.mutation(api.organizations.createOrganization, { name: "  " });
		expect(blank).toMatchObject({
			name: "VALIDATION_ERROR",
			message: "name: ERROR_ORGANIZATION_NAME_REQUIRED",
		});

		const [, taken] = await admin.mutation(api.organizations.createOrganization, {
			name: "Taken",
		});
		expect(taken).toMatchObject({
			name: "VALIDATION_ERROR",
			message: "name: ERROR_ORGANIZATION_NAME_TAKEN",
		});
	});

	it("refuses a blank or duplicate name, and an out-of-range AI limit, on update", async () => {
		const t = convexTest(schema, modules);
		const admin = await seedAdmin(t);
		const id = await seedOrganization(t, "Mine");
		await seedOrganization(t, "Theirs");

		const [, blank] = await admin.mutation(api.organizations.updateOrganization, {
			id,
			name: "",
		});
		expect(blank?.message).toBe("name: ERROR_ORGANIZATION_NAME_REQUIRED");

		const [, taken] = await admin.mutation(api.organizations.updateOrganization, {
			id,
			name: "Theirs",
		});
		expect(taken?.message).toBe("name: ERROR_ORGANIZATION_NAME_TAKEN");

		for (const aiImageMonthlyLimit of [-1, 1.5, 100001]) {
			const [, limit] = await admin.mutation(api.organizations.updateOrganization, {
				id,
				aiImageMonthlyLimit,
			});
			expect(limit).toMatchObject({
				name: "VALIDATION_ERROR",
				message: "aiImageMonthlyLimit: ERROR_ORGANIZATION_AI_IMAGE_LIMIT_INVALID",
			});
		}
	});

	it("reports a missing organization as ERROR_ORGANIZATION_NOT_FOUND", async () => {
		const t = convexTest(schema, modules);
		const admin = await seedAdmin(t);
		const id = await seedOrganization(t, "Doomed");
		await t.run(async (ctx) => ctx.db.delete(id));

		const [, read] = await admin.query(api.organizations.getOrganization, { id });
		const [, update] = await admin.mutation(api.organizations.updateOrganization, {
			id,
			name: "New",
		});
		const [, remove] = await admin.mutation(api.organizations.deleteOrganization, { id });

		for (const error of [read, update, remove]) {
			expect(error).toMatchObject({ name: "NOT_FOUND", message: "ERROR_ORGANIZATION_NOT_FOUND" });
		}
	});

	it("refuses to delete an organization with assigned users, saying how many", async () => {
		const t = convexTest(schema, modules);
		const admin = await seedAdmin(t);
		const id = await seedOrganization(t, "Staffed");
		await seedUserRole(t, { userId: "u1", roles: [USER_ROLES.OWNER], organizationId: id });
		await seedUserRole(t, { userId: "u2", roles: [USER_ROLES.OWNER], organizationId: id });

		const [, error] = await admin.mutation(api.organizations.deleteOrganization, { id });

		expect(error).toMatchObject({
			name: "VALIDATION_ERROR",
			message: "id: ERROR_ORGANIZATION_HAS_USERS:2",
		});
		expect(await t.run(async (ctx) => ctx.db.get(id))).not.toBeNull();
	});
});
