import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import { DEV_ONLY_ERROR_MESSAGE } from "../admin";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

type Roles = Array<"admin" | "owner" | "manager" | "customer" | "employee">;

// Preserve the schema generic so `ctx.db.query(...).withIndex(...)` can
// resolve user-defined indexes; using a bare ReturnType erases it to system
// tables only.
type T = ReturnType<typeof convexTest<typeof schema.tables>>;

async function seedUserRole(t: T, args: { userId: string; roles: Roles }) {
	await t.run(async (ctx) => {
		await ctx.db.insert("userRoles", {
			userId: args.userId,
			roles: args.roles,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
}

async function readRoles(t: T, userId: string) {
	return await t.run(async (ctx) =>
		ctx.db
			.query("userRoles")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first()
	);
}

describe("admin.devSetOwnRoles", () => {
	const originalEnv = process.env.CONVEX_ENV;

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.CONVEX_ENV;
		} else {
			process.env.CONVEX_ENV = originalEnv;
		}
	});

	describe("in development environment", () => {
		beforeEach(() => {
			process.env.CONVEX_ENV = "development";
		});

		it("lets a user with no roles assign themselves any role", async () => {
			const t = convexTest(schema, modules);
			const user = t.withIdentity({ subject: "newcomer", email: "new@example.com" });

			const [id, error] = await user.mutation(api.admin.devSetOwnRoles, {
				roles: ["admin"],
			});

			expect(error).toBeNull();
			expect(id).toBeTruthy();

			const record = await readRoles(t, "newcomer");
			expect(record?.roles).toEqual(["admin"]);
		});

		it("lets a non-admin user switch back to admin (the lockout-recovery case)", async () => {
			const t = convexTest(schema, modules);
			await seedUserRole(t, { userId: "user-1", roles: ["customer"] });

			const user = t.withIdentity({ subject: "user-1" });

			const [id, error] = await user.mutation(api.admin.devSetOwnRoles, {
				roles: ["admin"],
			});

			expect(error).toBeNull();
			expect(id).toBeTruthy();

			const record = await readRoles(t, "user-1");
			expect(record?.roles).toEqual(["admin"]);
		});

		it("supports an admin → employee → admin round trip", async () => {
			const t = convexTest(schema, modules);
			await seedUserRole(t, { userId: "user-1", roles: ["admin"] });

			const user = t.withIdentity({ subject: "user-1" });

			const [, errorDown] = await user.mutation(api.admin.devSetOwnRoles, {
				roles: ["employee"],
			});
			expect(errorDown).toBeNull();
			expect((await readRoles(t, "user-1"))?.roles).toEqual(["employee"]);

			const [, errorUp] = await user.mutation(api.admin.devSetOwnRoles, {
				roles: ["admin"],
			});
			expect(errorUp).toBeNull();
			expect((await readRoles(t, "user-1"))?.roles).toEqual(["admin"]);
		});

		it("rejects unauthenticated callers", async () => {
			const t = convexTest(schema, modules);

			const [value, error] = await t.mutation(api.admin.devSetOwnRoles, {
				roles: ["admin"],
			});

			expect(value).toBeNull();
			expect(error).toBeTruthy();
			expect(error!.name).toBe("NOT_AUTHENTICATED");
		});

		it("treats `dev` as a valid alias", async () => {
			process.env.CONVEX_ENV = "dev";
			const t = convexTest(schema, modules);
			const user = t.withIdentity({ subject: "user-1" });

			const [, error] = await user.mutation(api.admin.devSetOwnRoles, {
				roles: ["manager"],
			});

			expect(error).toBeNull();
		});
	});

	describe("outside development environment", () => {
		it("blocks production deployments even for admins", async () => {
			process.env.CONVEX_ENV = "production";
			const t = convexTest(schema, modules);
			await seedUserRole(t, { userId: "admin-1", roles: ["admin"] });

			const admin = t.withIdentity({ subject: "admin-1" });

			const [value, error] = await admin.mutation(api.admin.devSetOwnRoles, {
				roles: ["customer"],
			});

			expect(value).toBeNull();
			expect(error).toBeTruthy();
			expect(error!.name).toBe("NOT_AUTHORIZED");
			expect(error!.message).toBe(DEV_ONLY_ERROR_MESSAGE);

			const record = await readRoles(t, "admin-1");
			expect(record?.roles).toEqual(["admin"]);
		});

		it("blocks staging deployments", async () => {
			process.env.CONVEX_ENV = "staging";
			const t = convexTest(schema, modules);
			await seedUserRole(t, { userId: "admin-1", roles: ["admin"] });

			const admin = t.withIdentity({ subject: "admin-1" });

			const [, error] = await admin.mutation(api.admin.devSetOwnRoles, {
				roles: ["customer"],
			});

			expect(error).toBeTruthy();
			expect(error!.name).toBe("NOT_AUTHORIZED");
			expect(error!.message).toBe(DEV_ONLY_ERROR_MESSAGE);
		});

		it("defaults to production behavior when CONVEX_ENV is unset", async () => {
			delete process.env.CONVEX_ENV;
			const t = convexTest(schema, modules);
			await seedUserRole(t, { userId: "admin-1", roles: ["admin"] });

			const admin = t.withIdentity({ subject: "admin-1" });

			const [, error] = await admin.mutation(api.admin.devSetOwnRoles, {
				roles: ["customer"],
			});

			expect(error).toBeTruthy();
			expect(error!.name).toBe("NOT_AUTHORIZED");
			expect(error!.message).toBe(DEV_ONLY_ERROR_MESSAGE);
		});

		it("rejects unrecognized environment values as production", async () => {
			process.env.CONVEX_ENV = "preview";
			const t = convexTest(schema, modules);
			const user = t.withIdentity({ subject: "user-1" });

			const [, error] = await user.mutation(api.admin.devSetOwnRoles, {
				roles: ["manager"],
			});

			expect(error).toBeTruthy();
			expect(error!.name).toBe("NOT_AUTHORIZED");
			expect(error!.message).toBe(DEV_ONLY_ERROR_MESSAGE);
		});
	});
});
