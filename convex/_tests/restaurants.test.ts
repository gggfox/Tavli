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
				slug: "test-restaurant",
				currency: "USD",
				organizationId: orgId,
			});

			expect(error).toBeNull();
			expect(id).toBeTruthy();

			const menus = await t.query(api.menus.getMenusByRestaurant, { restaurantId: id! });
			expect(menus).toHaveLength(1);
			expect(menus![0].name).toBe("test-restaurant");
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
