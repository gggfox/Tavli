import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import {
	ADMIN_BOOTSTRAP_REFUSAL,
	decideAdminBootstrap,
	hasExistingOwnerOrAdmin,
	promoteToOwnerAdmin,
	type BootstrapRoleRow,
} from "../adminHelpers";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

type Roles = Array<"admin" | "owner" | "manager" | "customer" | "employee">;

// Preserve the schema generic so index-aware queries resolve user-defined
// indexes (mirrors admin.test.ts).
type T = ReturnType<typeof convexTest<typeof schema.tables>>;

async function seedUserRole(
	t: T,
	args: { userId: string; roles: Roles; email?: string }
): Promise<string> {
	return await t.run(async (ctx) =>
		ctx.db.insert("userRoles", {
			userId: args.userId,
			email: args.email,
			roles: args.roles,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		})
	);
}

async function readRoles(t: T, userId: string) {
	return await t.run(async (ctx) =>
		ctx.db
			.query("userRoles")
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first()
	);
}

// ---------------------------------------------------------------------------
// Pure decision logic — the four required guard cases, no Convex runtime.
// ---------------------------------------------------------------------------
describe("decideAdminBootstrap", () => {
	const targetRow = { _id: "row-1", roles: ["customer"] as Roles };

	it("refuses without the ALLOW_ADMIN_BOOTSTRAP flag", () => {
		const decision = decideAdminBootstrap({
			allowBootstrap: false,
			existingRoleRows: [targetRow],
			targetRow,
		});
		expect(decision).toEqual({ ok: false, reason: ADMIN_BOOTSTRAP_REFUSAL.DISABLED });
	});

	it("refuses when an owner already exists", () => {
		const decision = decideAdminBootstrap({
			allowBootstrap: true,
			existingRoleRows: [{ _id: "owner-row", roles: ["owner"] }, targetRow],
			targetRow,
		});
		expect(decision).toEqual({
			ok: false,
			reason: ADMIN_BOOTSTRAP_REFUSAL.ALREADY_INITIALIZED,
		});
	});

	it("refuses when an admin already exists", () => {
		const decision = decideAdminBootstrap({
			allowBootstrap: true,
			existingRoleRows: [{ _id: "admin-row", roles: ["admin"] }, targetRow],
			targetRow,
		});
		expect(decision).toEqual({
			ok: false,
			reason: ADMIN_BOOTSTRAP_REFUSAL.ALREADY_INITIALIZED,
		});
	});

	it("refuses for a missing target user", () => {
		const decision = decideAdminBootstrap({
			allowBootstrap: true,
			existingRoleRows: [{ roles: ["customer"] }],
			targetRow: null,
		});
		expect(decision).toEqual({ ok: false, reason: ADMIN_BOOTSTRAP_REFUSAL.USER_NOT_FOUND });
	});

	it("promotes correctly, preserving existing roles", () => {
		const decision = decideAdminBootstrap({
			allowBootstrap: true,
			existingRoleRows: [targetRow],
			targetRow,
		});
		expect(decision).toEqual({
			ok: true,
			targetRowId: "row-1",
			previousRoles: ["customer"],
			nextRoles: ["customer", "owner", "admin"],
		});
	});

	it("does not duplicate roles the target already holds", () => {
		const row = { _id: "row-2", roles: ["owner"] as Roles };
		// An existing owner short-circuits at the ALREADY_INITIALIZED guard, so
		// exercise the merge helper directly for the dedupe contract.
		expect(promoteToOwnerAdmin(row.roles)).toEqual(["owner", "admin"]);
	});
});

describe("hasExistingOwnerOrAdmin", () => {
	it("ignores non-privileged roles", () => {
		const rows: BootstrapRoleRow[] = [
			{ roles: ["customer"] },
			{ roles: ["manager", "employee"] },
			{ roles: [] },
			{},
		];
		expect(hasExistingOwnerOrAdmin(rows)).toBe(false);
	});

	it("detects owner or admin anywhere in the set", () => {
		expect(hasExistingOwnerOrAdmin([{ roles: ["manager"] }, { roles: ["admin"] }])).toBe(true);
		expect(hasExistingOwnerOrAdmin([{ roles: ["owner"] }])).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Integration — the internalMutation wiring, env gating, and audit trail.
// ---------------------------------------------------------------------------
describe("admin.bootstrapFirstAdmin", () => {
	const originalFlag = process.env.ALLOW_ADMIN_BOOTSTRAP;

	function armBootstrap() {
		process.env.ALLOW_ADMIN_BOOTSTRAP = "true";
	}

	afterEach(() => {
		if (originalFlag === undefined) {
			delete process.env.ALLOW_ADMIN_BOOTSTRAP;
		} else {
			process.env.ALLOW_ADMIN_BOOTSTRAP = originalFlag;
		}
	});

	describe("with the flag armed", () => {
		beforeEach(() => {
			armBootstrap();
		});

		it("promotes an existing user matched by Clerk subject", async () => {
			const t = convexTest(schema, modules);
			await seedUserRole(t, { userId: "founder", roles: ["customer"] });

			const result = await t.mutation(internal.admin.bootstrapFirstAdmin, {
				clerkSubject: "founder",
			});

			expect(result.ok).toBe(true);
			expect(result.roles).toEqual(["customer", "owner", "admin"]);
			expect((await readRoles(t, "founder"))?.roles).toEqual(["customer", "owner", "admin"]);
		});

		it("promotes an existing user matched by email (case-insensitive)", async () => {
			const t = convexTest(schema, modules);
			await seedUserRole(t, {
				userId: "founder",
				roles: ["customer"],
				email: "founder@example.com",
			});

			const result = await t.mutation(internal.admin.bootstrapFirstAdmin, {
				email: "  Founder@Example.com ",
			});

			expect(result.ok).toBe(true);
			expect((await readRoles(t, "founder"))?.roles).toEqual(["customer", "owner", "admin"]);
		});

		it("writes a bootstrap audit event", async () => {
			const t = convexTest(schema, modules);
			await seedUserRole(t, { userId: "founder", roles: ["customer"] });

			await t.mutation(internal.admin.bootstrapFirstAdmin, { clerkSubject: "founder" });

			const events = await t.run(async (ctx) =>
				ctx.db
					.query("allEvents")
					.filter((q) => q.eq(q.field("eventType"), "userRoles.bootstrap_first_admin"))
					.collect()
			);
			expect(events).toHaveLength(1);
			expect(events[0]?.payload).toEqual({
				roles: ["customer", "owner", "admin"],
				previousRoles: ["customer"],
				matchedBy: "clerkSubject",
			});
		});

		it("refuses when an admin already exists (first-admin only)", async () => {
			const t = convexTest(schema, modules);
			await seedUserRole(t, { userId: "existing-admin", roles: ["admin"] });
			await seedUserRole(t, { userId: "founder", roles: ["customer"] });

			await expect(
				t.mutation(internal.admin.bootstrapFirstAdmin, { clerkSubject: "founder" })
			).rejects.toThrow(ADMIN_BOOTSTRAP_REFUSAL.ALREADY_INITIALIZED);

			// Target is left untouched.
			expect((await readRoles(t, "founder"))?.roles).toEqual(["customer"]);
		});

		it("refuses for a user that does not exist", async () => {
			const t = convexTest(schema, modules);

			await expect(
				t.mutation(internal.admin.bootstrapFirstAdmin, { clerkSubject: "ghost" })
			).rejects.toMatchObject({
				name: "NOT_FOUND",
				message: ADMIN_BOOTSTRAP_REFUSAL.USER_NOT_FOUND,
			});
		});

		it("requires exactly one selector", async () => {
			const t = convexTest(schema, modules);
			await seedUserRole(t, { userId: "founder", roles: ["customer"] });

			await expect(t.mutation(internal.admin.bootstrapFirstAdmin, {})).rejects.toMatchObject({
				name: "VALIDATION_ERROR",
			});

			await expect(
				t.mutation(internal.admin.bootstrapFirstAdmin, {
					email: "founder@example.com",
					clerkSubject: "founder",
				})
			).rejects.toMatchObject({ name: "VALIDATION_ERROR" });
		});
	});

	it("is inert without the ALLOW_ADMIN_BOOTSTRAP flag", async () => {
		delete process.env.ALLOW_ADMIN_BOOTSTRAP;
		const t = convexTest(schema, modules);
		await seedUserRole(t, { userId: "founder", roles: ["customer"] });

		await expect(
			t.mutation(internal.admin.bootstrapFirstAdmin, { clerkSubject: "founder" })
		).rejects.toThrow(ADMIN_BOOTSTRAP_REFUSAL.DISABLED);

		expect((await readRoles(t, "founder"))?.roles).toEqual(["customer"]);
	});
});
