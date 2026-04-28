import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

async function seedOrganization(t: ReturnType<typeof convexTest>) {
	let orgId: Id<"organizations">;
	await t.run(async (ctx) => {
		orgId = await ctx.db.insert("organizations", {
			name: "Test Org",
			isActive: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	});
	return orgId!;
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

describe("restaurants", () => {
	describe("create", () => {
		it("creates a restaurant when authenticated", async () => {
			const t = convexTest(schema, modules);
			const authed = t.withIdentity({ subject: "user1" });
			const orgId = await seedOrganization(t);
			await seedUserRole(t, { userId: "user1", roles: ["owner"], organizationId: orgId });

			const [id, error] = await authed.mutation(api.restaurants.create, {
				name: "Test Restaurant",
				slug: "test-restaurant",
				currency: "USD",
				organizationId: orgId,
			});

			expect(error).toBeNull();
			expect(id).toBeTruthy();
		});

		it("fails when not authenticated", async () => {
			const t = convexTest(schema, modules);
			const orgId = await seedOrganization(t);

			const [value, error] = await t.mutation(api.restaurants.create, {
				name: "Test Restaurant",
				slug: "test-restaurant",
				currency: "USD",
				organizationId: orgId,
			});

			expect(value).toBeNull();
			expect(error).toBeTruthy();
			expect(error!.name).toBe("NOT_AUTHENTICATED");
		});

		it("rejects duplicate slugs", async () => {
			const t = convexTest(schema, modules);
			const authed = t.withIdentity({ subject: "user1" });
			const orgId = await seedOrganization(t);
			await seedUserRole(t, { userId: "user1", roles: ["owner"], organizationId: orgId });

			await authed.mutation(api.restaurants.create, {
				name: "First",
				slug: "same-slug",
				currency: "USD",
				organizationId: orgId,
			});

			const [value, error] = await authed.mutation(api.restaurants.create, {
				name: "Second",
				slug: "same-slug",
				currency: "EUR",
				organizationId: orgId,
			});

			expect(value).toBeNull();
			expect(error).toBeTruthy();
			expect(error!.name).toBe("VALIDATION_ERROR");
		});
	});

	describe("getBySlug", () => {
		it("returns the restaurant matching the slug", async () => {
			const t = convexTest(schema, modules);
			const authed = t.withIdentity({ subject: "user1" });
			const orgId = await seedOrganization(t);
			await seedUserRole(t, { userId: "user1", roles: ["owner"], organizationId: orgId });

			await authed.mutation(api.restaurants.create, {
				name: "Pizzeria",
				slug: "pizzeria",
				currency: "EUR",
				organizationId: orgId,
			});

			const restaurant = await t.query(api.restaurants.getBySlug, { slug: "pizzeria" });
			expect(restaurant).toBeTruthy();
			expect(restaurant!.name).toBe("Pizzeria");
			expect(restaurant!.slug).toBe("pizzeria");
			expect(restaurant!.isActive).toBe(false);
		});

		it("returns null for a non-existent slug", async () => {
			const t = convexTest(schema, modules);
			const result = await t.query(api.restaurants.getBySlug, { slug: "nope" });
			expect(result).toBeNull();
		});
	});

	describe("getByOwner", () => {
		it("returns restaurants owned by the authenticated user", async () => {
			const t = convexTest(schema, modules);
			const authed = t.withIdentity({ subject: "owner1" });
			const orgId = await seedOrganization(t);
			await seedUserRole(t, { userId: "owner1", roles: ["owner"], organizationId: orgId });

			await authed.mutation(api.restaurants.create, {
				name: "My Place",
				slug: "my-place",
				currency: "USD",
				organizationId: orgId,
			});

			const [restaurants, error] = await authed.query(api.restaurants.getByOwner);
			expect(error).toBeNull();
			expect(restaurants).toHaveLength(1);
			expect(restaurants![0].name).toBe("My Place");
		});

		it("returns empty array when owner has no restaurants", async () => {
			const t = convexTest(schema, modules);
			const authed = t.withIdentity({ subject: "owner2" });

			const [restaurants, error] = await authed.query(api.restaurants.getByOwner);
			expect(error).toBeNull();
			expect(restaurants).toHaveLength(0);
		});
	});

	describe("toggleActive", () => {
		it("toggles the isActive state of a restaurant", async () => {
			const t = convexTest(schema, modules);
			const authed = t.withIdentity({ subject: "user1" });
			const orgId = await seedOrganization(t);

			await t.run(async (ctx) => {
				await ctx.db.insert("userRoles", {
					userId: "user1",
					roles: ["owner"],
					createdAt: Date.now(),
					updatedAt: Date.now(),
				});
			});

			const [id] = await authed.mutation(api.restaurants.create, {
				name: "Toggle Test",
				slug: "toggle-test",
				currency: "USD",
				organizationId: orgId,
			});

			const [newState, error] = await authed.mutation(api.restaurants.toggleActive, {
				restaurantId: id!,
			});

			expect(error).toBeNull();
			expect(newState).toBe(true);

			const [secondState] = await authed.mutation(api.restaurants.toggleActive, {
				restaurantId: id!,
			});
			expect(secondState).toBe(false);
		});
	});
});
