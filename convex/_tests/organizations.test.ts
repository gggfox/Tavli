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
