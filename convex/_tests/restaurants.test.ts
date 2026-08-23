import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE, USER_ROLES } from "../constants";
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
				currency: "USD",
				organizationId: orgId,
			});

			expect(error).toBeNull();
			expect(id).toBeTruthy();

			const menus = await t.query(api.menus.getMenusByRestaurant, { restaurantId: id! });
			expect(menus).toHaveLength(1);
			// Named after the RESTAURANT, not the slug: a derived slug can carry a
			// collision counter, and no operator wants a menu called "la-cocina-2".
			expect(menus![0].name).toBe("Test Restaurant");
		});

		it("derives the slug from the name so the form never has to ask", async () => {
			const t = convexTest(schema, modules);
			const authed = t.withIdentity({ subject: "user1" });
			const orgId = await seedOrganization(t);
			await seedUserRole(t, { userId: "user1", roles: ["owner"], organizationId: orgId });

			const [id, error] = await authed.mutation(api.restaurants.create, {
				name: "Café Ñoño",
				currency: "MXN",
				organizationId: orgId,
			});

			expect(error).toBeNull();
			const doc = await t.run(async (ctx) => ctx.db.get(id!));
			expect(doc!.slug).toBe("cafe-nono");
		});

		it("settles repeated names with a dash counter", async () => {
			const t = convexTest(schema, modules);
			const authed = t.withIdentity({ subject: "user1" });
			const orgId = await seedOrganization(t);
			await seedUserRole(t, { userId: "user1", roles: ["owner"], organizationId: orgId });

			const slugs: string[] = [];
			for (let i = 0; i < 3; i++) {
				const [id, error] = await authed.mutation(api.restaurants.create, {
					name: "La Cocina",
					currency: "MXN",
					organizationId: orgId,
				});
				expect(error).toBeNull();
				const doc = await t.run(async (ctx) => ctx.db.get(id!));
				slugs.push(doc!.slug);
			}

			expect(slugs).toEqual(["la-cocina", "la-cocina-2", "la-cocina-3"]);
		});

		it("reuses the slug of a soft-deleted restaurant", async () => {
			const t = convexTest(schema, modules);
			const authed = t.withIdentity({ subject: "user1" });
			const orgId = await seedOrganization(t);
			await seedUserRole(t, { userId: "user1", roles: ["owner"], organizationId: orgId });

			// Seeded directly: the soft-delete mutation tombstones the slug, so
			// only a hand-written row can still hold the plain one.
			await t.run(async (ctx) => {
				const now = Date.now();
				await ctx.db.insert("restaurants", {
					ownerId: "user1",
					organizationId: orgId,
					name: "La Cocina",
					slug: "la-cocina",
					currency: "MXN",
					isActive: false,
					deletedAt: now,
					deletedBy: "user1",
					createdAt: now,
					updatedAt: now,
				});
			});

			const [id, error] = await authed.mutation(api.restaurants.create, {
				name: "La Cocina",
				currency: "MXN",
				organizationId: orgId,
			});

			expect(error).toBeNull();
			const doc = await t.run(async (ctx) => ctx.db.get(id!));
			expect(doc!.slug).toBe("la-cocina");
		});

		it("normalizes an explicitly supplied slug", async () => {
			const t = convexTest(schema, modules);
			const authed = t.withIdentity({ subject: "user1" });
			const orgId = await seedOrganization(t);
			await seedUserRole(t, { userId: "user1", roles: ["owner"], organizationId: orgId });

			const [id, error] = await authed.mutation(api.restaurants.create, {
				name: "Imported",
				slug: "  Mi Café!  ",
				currency: "MXN",
				organizationId: orgId,
			});

			expect(error).toBeNull();
			const doc = await t.run(async (ctx) => ctx.db.get(id!));
			expect(doc!.slug).toBe("mi-cafe");
		});

		it("rejects an explicit slug that normalizes to nothing", async () => {
			const t = convexTest(schema, modules);
			const authed = t.withIdentity({ subject: "user1" });
			const orgId = await seedOrganization(t);
			await seedUserRole(t, { userId: "user1", roles: ["owner"], organizationId: orgId });

			const [value, error] = await authed.mutation(api.restaurants.create, {
				name: "Blank",
				slug: "   ",
				currency: "MXN",
				organizationId: orgId,
			});

			expect(value).toBeNull();
			expect(error!.name).toBe("VALIDATION_ERROR");
			expect(error!.message).toContain("ERROR_SLUG_INVALID");
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

		it("rejects duplicate slugs with a stable code", async () => {
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
			// Prose used to fall through to the generic frontend copy.
			expect(error!.message).toContain("ERROR_SLUG_TAKEN");
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

		it("does not expose internal fields to anonymous callers", async () => {
			const t = convexTest(schema, modules);
			const authed = t.withIdentity({ subject: "user1" });
			const orgId = await seedOrganization(t);
			await seedUserRole(t, { userId: "user1", roles: ["owner"], organizationId: orgId });

			await authed.mutation(api.restaurants.create, {
				name: "Secret Fields",
				slug: "secret-fields",
				currency: "USD",
				organizationId: orgId,
			});

			await t.run(async (ctx) => {
				const row = await ctx.db
					.query("restaurants")
					.withIndex("by_slug", (q) => q.eq("slug", "secret-fields"))
					.first();
				if (!row) throw new Error("missing restaurant");
				await ctx.db.patch(row._id, {
					stripeAccountId: "acct_secret",
					sharedEmployeeClerkSubject: "user_shared123456789012345678",
				});
			});

			const restaurant = await t.query(api.restaurants.getBySlug, { slug: "secret-fields" });
			expect(restaurant).toBeTruthy();
			expect(restaurant).not.toHaveProperty("ownerId");
			expect(restaurant).not.toHaveProperty("organizationId");
			expect(restaurant).not.toHaveProperty("stripeAccountId");
			expect(restaurant).not.toHaveProperty("sharedEmployeeClerkSubject");
		});

		it("returns null for a non-existent slug", async () => {
			const t = convexTest(schema, modules);
			const result = await t.query(api.restaurants.getBySlug, { slug: "nope" });
			expect(result).toBeNull();
		});
	});

	describe("getAll", () => {
		it("returns every restaurant for platform admin", async () => {
			const t = convexTest(schema, modules);
			await seedUserRole(t, { userId: "admin1", roles: [USER_ROLES.ADMIN] });
			const orgId = await seedOrganization(t);
			await t.run(async (ctx) => {
				const now = Date.now();
				await ctx.db.insert("restaurants", {
					ownerId: "owner-x",
					organizationId: orgId,
					name: "One",
					slug: "admin-one",
					currency: "USD",
					isActive: true,
					createdAt: now,
					updatedAt: now,
				});
				await ctx.db.insert("restaurants", {
					ownerId: "owner-x",
					organizationId: orgId,
					name: "Two",
					slug: "admin-two",
					currency: "USD",
					isActive: true,
					createdAt: now,
					updatedAt: now,
				});
			});

			const authed = t.withIdentity({ subject: "admin1" });
			const [list, err] = await authed.query(api.restaurants.getAll);
			expect(err).toBeNull();
			expect(list).toHaveLength(2);
		});

		it("includes all restaurants in an org for org-level owner", async () => {
			const t = convexTest(schema, modules);
			const orgId = await seedOrganization(t);
			await seedUserRole(t, {
				userId: "orgOwner",
				roles: [USER_ROLES.OWNER],
				organizationId: orgId,
			});
			await t.run(async (ctx) => {
				const now = Date.now();
				await ctx.db.insert("restaurants", {
					ownerId: "creator",
					organizationId: orgId,
					name: "North",
					slug: "org-north",
					currency: "USD",
					isActive: true,
					createdAt: now,
					updatedAt: now,
				});
				await ctx.db.insert("restaurants", {
					ownerId: "creator",
					organizationId: orgId,
					name: "South",
					slug: "org-south",
					currency: "USD",
					isActive: true,
					createdAt: now,
					updatedAt: now,
				});
			});

			const authed = t.withIdentity({ subject: "orgOwner" });
			const [list, err] = await authed.query(api.restaurants.getAll);
			expect(err).toBeNull();
			expect(list).toHaveLength(2);
		});

		it("scopes to active membership for org staff who are not org owners", async () => {
			const t = convexTest(schema, modules);
			const orgId = await seedOrganization(t);
			const rA = await t.run(async (ctx) => {
				const now = Date.now();
				return await ctx.db.insert("restaurants", {
					ownerId: "creator",
					organizationId: orgId,
					name: "A",
					slug: "emp-only-a",
					currency: "USD",
					isActive: true,
					createdAt: now,
					updatedAt: now,
				});
			});
			await t.run(async (ctx) => {
				const now = Date.now();
				await ctx.db.insert("restaurants", {
					ownerId: "creator",
					organizationId: orgId,
					name: "B",
					slug: "emp-only-b",
					currency: "USD",
					isActive: true,
					createdAt: now,
					updatedAt: now,
				});
			});
			await seedUserRole(t, {
				userId: "emp1",
				roles: [USER_ROLES.EMPLOYEE],
				organizationId: orgId,
			});
			await t.run(async (ctx) => {
				const now = Date.now();
				await ctx.db.insert("restaurantMembers", {
					userId: "emp1",
					restaurantId: rA,
					organizationId: orgId,
					role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
					isActive: true,
					createdAt: now,
					updatedAt: now,
				});
			});

			const authed = t.withIdentity({ subject: "emp1" });
			const [list, err] = await authed.query(api.restaurants.getAll);
			expect(err).toBeNull();
			expect(list).toHaveLength(1);
			expect(list![0]._id).toBe(rA);
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
					organizationId: orgId,
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

		it("allows org-level owner who is not restaurants.ownerId to toggle active", async () => {
			const t = convexTest(schema, modules);
			const orgId = await seedOrganization(t);
			const restaurantId = await t.run(async (ctx) => {
				const now = Date.now();
				return await ctx.db.insert("restaurants", {
					ownerId: "creator-user",
					organizationId: orgId,
					name: "Shared Location",
					slug: "shared-location",
					currency: "USD",
					isActive: true,
					createdAt: now,
					updatedAt: now,
				});
			});
			await seedUserRole(t, {
				userId: "orgOwner",
				roles: ["owner"],
				organizationId: orgId,
			});

			const authed = t.withIdentity({ subject: "orgOwner" });
			const [newState, error] = await authed.mutation(api.restaurants.toggleActive, {
				restaurantId,
			});

			expect(error).toBeNull();
			expect(newState).toBe(false);
		});

		it("allows toggle when org owner match is on a non-first userRoles row", async () => {
			const t = convexTest(schema, modules);
			const orgA = await seedOrganization(t);
			const orgB = await t.run(async (ctx) => {
				const now = Date.now();
				return await ctx.db.insert("organizations", {
					name: "Other Org",
					isActive: true,
					createdAt: now,
					updatedAt: now,
				});
			});
			const restaurantId = await t.run(async (ctx) => {
				const now = Date.now();
				return await ctx.db.insert("restaurants", {
					ownerId: "creator-user",
					organizationId: orgA,
					name: "Org A Location",
					slug: "org-a-location",
					currency: "USD",
					isActive: true,
					createdAt: now,
					updatedAt: now,
				});
			});

			await t.run(async (ctx) => {
				const t0 = Date.now();
				await ctx.db.insert("userRoles", {
					userId: "multiRowUser",
					roles: ["owner"],
					organizationId: orgB,
					createdAt: t0,
					updatedAt: t0,
				});
				await ctx.db.insert("userRoles", {
					userId: "multiRowUser",
					roles: ["owner"],
					organizationId: orgA,
					createdAt: t0 + 1,
					updatedAt: t0 + 1,
				});
			});

			const authed = t.withIdentity({ subject: "multiRowUser" });
			const [newState, error] = await authed.mutation(api.restaurants.toggleActive, {
				restaurantId,
			});

			expect(error).toBeNull();
			expect(newState).toBe(false);
		});
	});

	describe("softDelete and restore", () => {
		it("soft-deletes, hides from getBySlug and getAll, lists in getDeletedForAdmin, then restores", async () => {
			const t = convexTest(schema, modules);
			const authed = t.withIdentity({ subject: "owner-del" });
			const orgId = await seedOrganization(t);
			await seedUserRole(t, {
				userId: "owner-del",
				roles: [USER_ROLES.OWNER],
				organizationId: orgId,
			});

			const [rid] = await authed.mutation(api.restaurants.create, {
				name: "Del Me",
				slug: "del-me-slug",
				currency: "USD",
				organizationId: orgId,
			});
			expect(rid).toBeTruthy();

			const [, delErr] = await authed.mutation(api.restaurants.softDelete, { restaurantId: rid! });
			expect(delErr).toBeNull();

			const bySlug = await t.query(api.restaurants.getBySlug, { slug: "del-me-slug" });
			expect(bySlug).toBeNull();

			const [allAfter, allErr] = await authed.query(api.restaurants.getAll);
			expect(allErr).toBeNull();
			expect(allAfter!.some((r) => r._id === rid)).toBe(false);

			const [deletedList, delListErr] = await authed.query(api.restaurants.getDeletedForAdmin);
			expect(delListErr).toBeNull();
			expect(deletedList!.some((r) => r._id === rid)).toBe(true);

			const [, restErr] = await authed.mutation(api.restaurants.restore, { restaurantId: rid! });
			expect(restErr).toBeNull();

			const bySlug2 = await t.query(api.restaurants.getBySlug, { slug: "del-me-slug" });
			expect(bySlug2).not.toBeNull();
			expect(bySlug2!.name).toBe("Del Me");
		});

		it("rejects softDelete for restaurant manager without org/document owner", async () => {
			const t = convexTest(schema, modules);
			const orgId = await seedOrganization(t);
			const restaurantId = await t.run(async (ctx) => {
				const now = Date.now();
				return await ctx.db.insert("restaurants", {
					ownerId: "creator",
					organizationId: orgId,
					name: "Mgr Test",
					slug: "mgr-test-rest",
					currency: "USD",
					isActive: true,
					createdAt: now,
					updatedAt: now,
				});
			});
			await seedUserRole(t, {
				userId: "mgrOnly",
				roles: [USER_ROLES.MANAGER],
				organizationId: orgId,
			});
			await t.run(async (ctx) => {
				const now = Date.now();
				await ctx.db.insert("restaurantMembers", {
					userId: "mgrOnly",
					restaurantId,
					organizationId: orgId,
					role: RESTAURANT_MEMBER_ROLE.MANAGER,
					isActive: true,
					createdAt: now,
					updatedAt: now,
				});
			});

			const mgrAuthed = t.withIdentity({ subject: "mgrOnly" });
			const [, err] = await mgrAuthed.mutation(api.restaurants.softDelete, { restaurantId });
			expect(err).not.toBeNull();
			expect(err!.name).toBe("NOT_AUTHORIZED");
		});
	});

	describe("hard purge", () => {
		it("purgeRestaurantInternal removes restaurant and menus", async () => {
			const t = convexTest(schema, modules);
			const authed = t.withIdentity({ subject: "purge-owner" });
			const orgId = await seedOrganization(t);
			await seedUserRole(t, {
				userId: "purge-owner",
				roles: [USER_ROLES.OWNER],
				organizationId: orgId,
			});

			const [rid] = await authed.mutation(api.restaurants.create, {
				name: "Purge Me",
				slug: "purge-me",
				currency: "USD",
				organizationId: orgId,
			});
			expect(rid).toBeTruthy();

			const [, delErr] = await authed.mutation(api.restaurants.softDelete, { restaurantId: rid! });
			expect(delErr).toBeNull();

			const purgeResult = await t.mutation(internal.restaurantPurge.purgeRestaurantInternal, {
				restaurantId: rid!,
			});
			expect(purgeResult.purged).toBe(true);

			const doc = await t.run(async (ctx) => ctx.db.get(rid!));
			expect(doc).toBeNull();

			const menus = await t.query(api.menus.getMenusByRestaurant, { restaurantId: rid! });
			expect(menus).toHaveLength(0);

			const events = await t.run(async (ctx) =>
				ctx.db
					.query("allEvents")
					.filter((q) => q.eq(q.field("eventType"), "restaurants.hard_deleted"))
					.collect()
			);
			expect(events.some((e) => e.aggregateId === String(rid))).toBe(true);
		});
	});
});

describe("setSharedEmployeeSubject", () => {
	const VALID_SUBJECT = "user_2NNEqL2nrIRdJ1slkLWQabc123";
	const OTHER_SUBJECT = "user_3OOFrM3osJSeK2tmlMXRdef456";

	async function seedOwnedRestaurant(
		t: ReturnType<typeof convexTest>,
		args: { ownerId: string; slug: string }
	) {
		const orgId = await seedOrganization(t);
		await seedUserRole(t, {
			userId: args.ownerId,
			roles: [USER_ROLES.OWNER],
			organizationId: orgId,
		});
		const authed = t.withIdentity({ subject: args.ownerId });
		const [restaurantId] = await authed.mutation(api.restaurants.create, {
			name: "Shared Employee Test",
			slug: args.slug,
			currency: "USD",
			organizationId: orgId,
		});
		return { orgId, restaurantId: restaurantId!, authed };
	}

	it("binds a valid Clerk subject for owner/admin", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, authed } = await seedOwnedRestaurant(t, {
			ownerId: "owner-subject",
			slug: "subject-bind-ok",
		});

		const [, err] = await authed.mutation(api.restaurants.setSharedEmployeeSubject, {
			restaurantId,
			clerkSubject: VALID_SUBJECT,
		});

		expect(err).toBeNull();
		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.sharedEmployeeClerkSubject).toBe(VALID_SUBJECT);
	});

	it("rejects empty or malformed clerkSubject", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, authed } = await seedOwnedRestaurant(t, {
			ownerId: "owner-invalid-subject",
			slug: "subject-bind-invalid",
		});

		for (const clerkSubject of ["", "   ", "not-a-clerk-subject", "user_short"]) {
			const [, err] = await authed.mutation(api.restaurants.setSharedEmployeeSubject, {
				restaurantId,
				clerkSubject,
			});
			expect(err).not.toBeNull();
			expect(err!.name).toBe("VALIDATION_ERROR");
			expect(err!.message).toContain("ERROR_INVALID_SHARED_EMPLOYEE_CLERK_SUBJECT");
		}
	});

	it("rejects binding a subject already used by another restaurant", async () => {
		const t = convexTest(schema, modules);
		const first = await seedOwnedRestaurant(t, {
			ownerId: "owner-subject-a",
			slug: "subject-bind-a",
		});
		const second = await seedOwnedRestaurant(t, {
			ownerId: "owner-subject-b",
			slug: "subject-bind-b",
		});

		const [, firstErr] = await first.authed.mutation(api.restaurants.setSharedEmployeeSubject, {
			restaurantId: first.restaurantId,
			clerkSubject: VALID_SUBJECT,
		});
		expect(firstErr).toBeNull();

		const [, secondErr] = await second.authed.mutation(api.restaurants.setSharedEmployeeSubject, {
			restaurantId: second.restaurantId,
			clerkSubject: VALID_SUBJECT,
		});
		expect(secondErr).not.toBeNull();
		expect(secondErr!.name).toBe("CONFLICT");
		expect(secondErr!.message).toBe("ERROR_SHARED_EMPLOYEE_SUBJECT_ALREADY_BOUND");
	});

	it("allows rebinding the same subject to the same restaurant", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, authed } = await seedOwnedRestaurant(t, {
			ownerId: "owner-rebind",
			slug: "subject-bind-rebind",
		});

		const [, firstErr] = await authed.mutation(api.restaurants.setSharedEmployeeSubject, {
			restaurantId,
			clerkSubject: VALID_SUBJECT,
		});
		expect(firstErr).toBeNull();

		const [, secondErr] = await authed.mutation(api.restaurants.setSharedEmployeeSubject, {
			restaurantId,
			clerkSubject: VALID_SUBJECT,
		});
		expect(secondErr).toBeNull();
	});

	it("trims whitespace before validating and storing", async () => {
		const t = convexTest(schema, modules);
		const { restaurantId, authed } = await seedOwnedRestaurant(t, {
			ownerId: "owner-trim",
			slug: "subject-bind-trim",
		});

		const [, err] = await authed.mutation(api.restaurants.setSharedEmployeeSubject, {
			restaurantId,
			clerkSubject: `  ${OTHER_SUBJECT}  `,
		});
		expect(err).toBeNull();

		const restaurant = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(restaurant?.sharedEmployeeClerkSubject).toBe(OTHER_SUBJECT);
	});

	it("rejects restaurant managers without owner/admin access", async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrganization(t);
		const restaurantId = await t.run(async (ctx) => {
			const now = Date.now();
			return await ctx.db.insert("restaurants", {
				ownerId: "creator",
				organizationId: orgId,
				name: "Mgr Subject Test",
				slug: "subject-bind-mgr",
				currency: "USD",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			});
		});
		await seedUserRole(t, {
			userId: "mgr-subject",
			roles: [USER_ROLES.MANAGER],
			organizationId: orgId,
		});
		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert("restaurantMembers", {
				userId: "mgr-subject",
				restaurantId,
				organizationId: orgId,
				role: RESTAURANT_MEMBER_ROLE.MANAGER,
				isActive: true,
				createdAt: now,
				updatedAt: now,
			});
		});

		const mgrAuthed = t.withIdentity({ subject: "mgr-subject" });
		const [, err] = await mgrAuthed.mutation(api.restaurants.setSharedEmployeeSubject, {
			restaurantId,
			clerkSubject: VALID_SUBJECT,
		});
		expect(err).not.toBeNull();
		expect(err!.name).toBe("NOT_AUTHORIZED");
	});
});

describe("update — receipt tax fields (TAVLI-71 Phase 3C)", () => {
	async function seedRestaurantForUpdate(t: ReturnType<typeof convexTest>) {
		const orgId = await seedOrganization(t);
		await seedUserRole(t, { userId: "tax-owner", roles: ["owner"], organizationId: orgId });
		const authed = t.withIdentity({ subject: "tax-owner" });
		const [restaurantId] = await authed.mutation(api.restaurants.create, {
			name: "Tax R",
			slug: `tax-r-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			organizationId: orgId,
		});
		return { orgId, authed, restaurantId: restaurantId! };
	}

	it("sets trimmed rfc / razonSocial / fiscalAddress", async () => {
		const t = convexTest(schema, modules);
		const { orgId, authed, restaurantId } = await seedRestaurantForUpdate(t);

		const [, error] = await authed.mutation(api.restaurants.update, {
			restaurantId,
			organizationId: orgId,
			rfc: "  COC010101ABC  ",
			razonSocial: " La Cocina S.A. de C.V. ",
			fiscalAddress: " Av. Siempre Viva 123 ",
		});
		expect(error).toBeNull();

		const doc = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(doc).toMatchObject({
			rfc: "COC010101ABC",
			razonSocial: "La Cocina S.A. de C.V.",
			fiscalAddress: "Av. Siempre Viva 123",
		});
	});

	it("clears a tax field when passed an empty string", async () => {
		const t = convexTest(schema, modules);
		const { orgId, authed, restaurantId } = await seedRestaurantForUpdate(t);

		await authed.mutation(api.restaurants.update, {
			restaurantId,
			organizationId: orgId,
			rfc: "COC010101ABC",
			razonSocial: "La Cocina S.A. de C.V.",
		});
		const [, error] = await authed.mutation(api.restaurants.update, {
			restaurantId,
			organizationId: orgId,
			rfc: "",
		});
		expect(error).toBeNull();

		const doc = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(doc?.rfc).toBeUndefined();
		// Untouched fields survive a partial update.
		expect(doc?.razonSocial).toBe("La Cocina S.A. de C.V.");
	});

	it("does not expose tax fields on the public restaurant shape", async () => {
		const t = convexTest(schema, modules);
		const { orgId, authed, restaurantId } = await seedRestaurantForUpdate(t);
		await authed.mutation(api.restaurants.update, {
			restaurantId,
			organizationId: orgId,
			rfc: "COC010101ABC",
			razonSocial: "La Cocina S.A. de C.V.",
			fiscalAddress: "Av. Siempre Viva 123",
		});

		const doc = await t.run(async (ctx) => ctx.db.get(restaurantId));
		const publicShape = await t.query(api.restaurants.getBySlug, { slug: doc!.slug });
		expect(publicShape).not.toBeNull();
		expect(publicShape).not.toHaveProperty("rfc");
		expect(publicShape).not.toHaveProperty("razonSocial");
		expect(publicShape).not.toHaveProperty("fiscalAddress");
	});
});

describe("update — public profile", () => {
	async function seedRestaurantForProfile(t: ReturnType<typeof convexTest>) {
		const orgId = await seedOrganization(t);
		await seedUserRole(t, { userId: "profile-owner", roles: ["owner"], organizationId: orgId });
		const authed = t.withIdentity({ subject: "profile-owner" });
		const [restaurantId] = await authed.mutation(api.restaurants.create, {
			name: "Profile R",
			slug: `profile-r-${Math.random().toString(36).slice(2, 10)}`,
			currency: "MXN",
			organizationId: orgId,
		});
		return { orgId, authed, restaurantId: restaurantId! };
	}

	it("normalizes the phone to E.164 and canonicalizes social links on write", async () => {
		const t = convexTest(schema, modules);
		const { orgId, authed, restaurantId } = await seedRestaurantForProfile(t);

		const [, error] = await authed.mutation(api.restaurants.update, {
			restaurantId,
			organizationId: orgId,
			phone: "+52 81 1234 5678",
			instagramUrl: "www.instagram.com/lacocina/?igshid=abc",
			xUrl: "https://twitter.com/lacocina",
		});
		expect(error).toBeNull();

		const doc = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(doc).toMatchObject({
			phone: "+528112345678",
			instagramUrl: "https://instagram.com/lacocina",
			// A restaurant that pasted a twitter.com link keeps a working link,
			// and the diner never sees the dead brand.
			xUrl: "https://x.com/lacocina",
		});
	});

	it("rejects a national-format phone with the country-code code, pinned to the field", async () => {
		const t = convexTest(schema, modules);
		const { orgId, authed, restaurantId } = await seedRestaurantForProfile(t);

		const [, error] = await authed.mutation(api.restaurants.update, {
			restaurantId,
			organizationId: orgId,
			phone: "81 1234 5678",
		});

		expect(error).not.toBeNull();
		expect(error).toMatchObject({
			fields: [{ field: "phone", message: "ERROR_PHONE_COUNTRY_CODE_REQUIRED" }],
		});
	});

	it("rejects a link that belongs to another platform", async () => {
		const t = convexTest(schema, modules);
		const { orgId, authed, restaurantId } = await seedRestaurantForProfile(t);

		const [, error] = await authed.mutation(api.restaurants.update, {
			restaurantId,
			organizationId: orgId,
			instagramUrl: "https://facebook.com/lacocina",
		});

		expect(error).toMatchObject({
			fields: [{ field: "instagramUrl", message: "ERROR_SOCIAL_URL_WRONG_PLATFORM" }],
		});
	});

	it("clears the WhatsApp flag when the number it pointed at is removed", async () => {
		const t = convexTest(schema, modules);
		const { orgId, authed, restaurantId } = await seedRestaurantForProfile(t);

		await authed.mutation(api.restaurants.update, {
			restaurantId,
			organizationId: orgId,
			phone: "+528112345678",
			phoneHasWhatsApp: true,
		});
		await authed.mutation(api.restaurants.update, {
			restaurantId,
			organizationId: orgId,
			phone: "",
		});

		const doc = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(doc?.phone).toBeUndefined();
		// A dangling flag would silently re-arm when a new number is added.
		expect(doc?.phoneHasWhatsApp).toBeUndefined();
	});

	it("refuses a WhatsApp flag with no number to reach", async () => {
		const t = convexTest(schema, modules);
		const { orgId, authed, restaurantId } = await seedRestaurantForProfile(t);

		const [, error] = await authed.mutation(api.restaurants.update, {
			restaurantId,
			organizationId: orgId,
			phoneHasWhatsApp: true,
		});

		expect(error).toMatchObject({
			fields: [{ field: "phoneHasWhatsApp", message: "ERROR_WHATSAPP_WITHOUT_PHONE" }],
		});
	});

	it("withholds the contact email from diners until the profile has been reviewed", async () => {
		const t = convexTest(schema, modules);
		const { orgId, authed, restaurantId } = await seedRestaurantForProfile(t);

		// A pre-existing row: the email was entered under the old copy, which
		// described it as an internal error-report address.
		await authed.mutation(api.restaurants.update, {
			restaurantId,
			organizationId: orgId,
			supportEmail: "it-alerts@internal.example",
		});

		const doc = await t.run(async (ctx) => ctx.db.get(restaurantId));
		const before = await t.query(api.restaurants.getBySlug, { slug: doc!.slug });
		expect(before?.contact).toBeUndefined();

		await authed.mutation(api.restaurants.update, {
			restaurantId,
			organizationId: orgId,
			markPublicProfileReviewed: true,
		});

		const after = await t.query(api.restaurants.getBySlug, { slug: doc!.slug });
		expect(after?.contact?.email).toBe("it-alerts@internal.example");
	});

	it("builds the wa.me link only when the number is flagged", async () => {
		const t = convexTest(schema, modules);
		const { orgId, authed, restaurantId } = await seedRestaurantForProfile(t);

		await authed.mutation(api.restaurants.update, {
			restaurantId,
			organizationId: orgId,
			phone: "+528112345678",
		});
		const doc = await t.run(async (ctx) => ctx.db.get(restaurantId));
		const withoutFlag = await t.query(api.restaurants.getBySlug, { slug: doc!.slug });
		expect(withoutFlag?.contact?.phone).toBe("+528112345678");
		expect(withoutFlag?.contact?.whatsAppUrl).toBeUndefined();

		await authed.mutation(api.restaurants.update, {
			restaurantId,
			organizationId: orgId,
			phoneHasWhatsApp: true,
		});
		const withFlag = await t.query(api.restaurants.getBySlug, { slug: doc!.slug });
		expect(withFlag?.contact?.whatsAppUrl).toBe("https://wa.me/528112345678");
	});

	it("omits the contact block entirely for a restaurant that published nothing", async () => {
		const t = convexTest(schema, modules);
		const { authed, restaurantId } = await seedRestaurantForProfile(t);
		void authed;

		const doc = await t.run(async (ctx) => ctx.db.get(restaurantId));
		const publicShape = await t.query(api.restaurants.getBySlug, { slug: doc!.slug });

		expect(publicShape).not.toBeNull();
		expect(publicShape?.contact).toBeUndefined();
	});

	it("never exposes the review timestamp or raw social columns to diners", async () => {
		const t = convexTest(schema, modules);
		const { orgId, authed, restaurantId } = await seedRestaurantForProfile(t);
		await authed.mutation(api.restaurants.update, {
			restaurantId,
			organizationId: orgId,
			instagramUrl: "instagram.com/lacocina",
			markPublicProfileReviewed: true,
		});

		const doc = await t.run(async (ctx) => ctx.db.get(restaurantId));
		const publicShape = await t.query(api.restaurants.getBySlug, { slug: doc!.slug });

		expect(publicShape).not.toHaveProperty("publicProfileReviewedAt");
		expect(publicShape).not.toHaveProperty("instagramUrl");
		expect(publicShape?.contact?.socials).toEqual({
			instagram: "https://instagram.com/lacocina",
		});
	});
});

describe("update — slug", () => {
	async function seedTwoRestaurants(t: ReturnType<typeof convexTest>) {
		const orgId = await seedOrganization(t);
		await seedUserRole(t, { userId: "slug-owner", roles: ["owner"], organizationId: orgId });
		const authed = t.withIdentity({ subject: "slug-owner" });
		const [restaurantId] = await authed.mutation(api.restaurants.create, {
			name: "La Cocina",
			currency: "MXN",
			organizationId: orgId,
		});
		const [otherId] = await authed.mutation(api.restaurants.create, {
			name: "El Fogón",
			currency: "MXN",
			organizationId: orgId,
		});
		return { orgId, authed, restaurantId: restaurantId!, otherId: otherId! };
	}

	it("normalizes whatever the operator typed", async () => {
		const t = convexTest(schema, modules);
		const { orgId, authed, restaurantId } = await seedTwoRestaurants(t);

		const [, error] = await authed.mutation(api.restaurants.update, {
			restaurantId,
			organizationId: orgId,
			slug: "  La Cocina Nueva!  ",
		});

		expect(error).toBeNull();
		const doc = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(doc!.slug).toBe("la-cocina-nueva");
	});

	it("refuses a blank slug instead of writing an empty string", async () => {
		// Regression: the conflict check was guarded by `args.slug &&` while the
		// patch fired on `args.slug !== undefined`, so "" skipped validation and
		// was stored, leaving the restaurant reachable only at `/r//en/menu`.
		const t = convexTest(schema, modules);
		const { orgId, authed, restaurantId } = await seedTwoRestaurants(t);

		const [value, error] = await authed.mutation(api.restaurants.update, {
			restaurantId,
			organizationId: orgId,
			slug: "   ",
		});

		expect(value).toBeNull();
		expect(error!.name).toBe("VALIDATION_ERROR");
		expect(error!.message).toContain("ERROR_SLUG_INVALID");
		const doc = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(doc!.slug).toBe("la-cocina");
	});

	it("reports a taken slug with a stable code", async () => {
		const t = convexTest(schema, modules);
		const { orgId, authed, restaurantId } = await seedTwoRestaurants(t);

		const [value, error] = await authed.mutation(api.restaurants.update, {
			restaurantId,
			organizationId: orgId,
			slug: "El Fogón",
		});

		expect(value).toBeNull();
		expect(error!.name).toBe("VALIDATION_ERROR");
		expect(error!.message).toContain("ERROR_SLUG_TAKEN");
		const doc = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(doc!.slug).toBe("la-cocina");
	});

	it("accepts the restaurant's own slug unchanged", async () => {
		const t = convexTest(schema, modules);
		const { orgId, authed, restaurantId } = await seedTwoRestaurants(t);

		const [, error] = await authed.mutation(api.restaurants.update, {
			restaurantId,
			organizationId: orgId,
			slug: "la-cocina",
		});

		expect(error).toBeNull();
		const doc = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(doc!.slug).toBe("la-cocina");
	});

	it("leaves the slug alone when the patch omits it", async () => {
		const t = convexTest(schema, modules);
		const { orgId, authed, restaurantId } = await seedTwoRestaurants(t);

		const [, error] = await authed.mutation(api.restaurants.update, {
			restaurantId,
			organizationId: orgId,
			description: "Comida casera",
		});

		expect(error).toBeNull();
		const doc = await t.run(async (ctx) => ctx.db.get(restaurantId));
		expect(doc!.slug).toBe("la-cocina");
	});
});
