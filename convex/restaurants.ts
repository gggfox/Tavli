import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedError,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { appendAuditEvent, stampUpdated } from "./_util/audit";
import {
	fetchUserRoleRecordsByUserId,
	getCurrentUserId,
	isAdmin,
	requireOwnerRole,
	requireRestaurantManagerOrAbove,
	requireRestaurantOwnerOrAdmin,
	RoleErrorMessages,
} from "./_util/auth";
import {
	RESTAURANT_MEMBER_ROLE,
	RESTAURANT_SOFT_DELETE_RETENTION_MS,
	TABLE,
	USER_ROLES,
} from "./constants";
import { insertMenuForRestaurant } from "./menus";

type AuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

function tombstoneSlug(restaurantId: Id<"restaurants">, slug: string): string {
	const safe = slug.replace(/[^a-zA-Z0-9_-]/g, "_");
	return `${safe}__deleted__${restaurantId}`;
}

export const softDelete = mutation({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<null, AuthErrors | NotFoundErrorObject | UserInputValidationErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) return [null, new NotFoundError("Restaurant not found").toObject()];
		if (restaurant.deletedAt != null) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "restaurantId", message: "Restaurant is already deleted" }],
				}).toObject(),
			];
		}

		const [, permErr] = await requireRestaurantOwnerOrAdmin(ctx, userId, args.restaurantId);
		if (permErr) return [null, permErr];

		const now = Date.now();
		const newSlug = tombstoneSlug(args.restaurantId, restaurant.slug);

		await ctx.db.patch(args.restaurantId, {
			deletedAt: now,
			deletedBy: userId,
			hardDeleteAfterAt: now + RESTAURANT_SOFT_DELETE_RETENTION_MS,
			slugBeforeSoftDelete: restaurant.slug,
			slug: newSlug,
			isActive: false,
			stripeAccountId: undefined,
			stripeOnboardingComplete: undefined,
			...stampUpdated(userId),
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESTAURANTS,
			aggregateId: String(args.restaurantId),
			eventType: "restaurants.soft_deleted",
			payload: { slugBefore: restaurant.slug, slugAfter: newSlug },
			userId,
		});

		return [null, null];
	},
});

export const restore = mutation({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<null, AuthErrors | NotFoundErrorObject | UserInputValidationErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) return [null, new NotFoundError("Restaurant not found").toObject()];
		if (restaurant.deletedAt == null) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "restaurantId", message: "Restaurant is not deleted" }],
				}).toObject(),
			];
		}

		const [, permErr] = await requireRestaurantOwnerOrAdmin(ctx, userId, args.restaurantId);
		if (permErr) return [null, permErr];

		const previous = restaurant.slugBeforeSoftDelete ?? restaurant.slug;
		let nextSlug = restaurant.slug;
		if (previous && previous !== restaurant.slug) {
			const occupant = await ctx.db
				.query(TABLE.RESTAURANTS)
				.withIndex("by_slug", (q) => q.eq("slug", previous))
				.first();
			if (!occupant || occupant._id === args.restaurantId) {
				nextSlug = previous;
			}
		}

		await ctx.db.patch(args.restaurantId, {
			deletedAt: undefined,
			deletedBy: undefined,
			hardDeleteAfterAt: undefined,
			slugBeforeSoftDelete: undefined,
			slug: nextSlug,
			...stampUpdated(userId),
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESTAURANTS,
			aggregateId: String(args.restaurantId),
			eventType: "restaurants.restored",
			payload: { slug: nextSlug },
			userId,
		});

		return [null, null];
	},
});

export const create = mutation({
	args: {
		name: v.string(),
		slug: v.string(),
		description: v.optional(v.string()),
		currency: v.string(),
		timezone: v.optional(v.string()),
		organizationId: v.id(TABLE.ORGANIZATIONS),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"restaurants">, AuthErrors | UserInputValidationErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];
		const [, error2] = await requireOwnerRole(ctx, userId);
		if (error2) return [null, error2];

		const existing = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_slug", (q) => q.eq("slug", args.slug))
			.first();

		if (existing && existing.deletedAt == null) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "slug", message: "This slug is already taken" }],
				}).toObject(),
			];
		}

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.RESTAURANTS, {
			ownerId: userId,
			organizationId: args.organizationId,
			name: args.name,
			slug: args.slug,
			description: args.description,
			currency: args.currency,
			timezone: args.timezone,
			isActive: false,
			createdAt: now,
			updatedAt: now,
			updatedBy: userId,
		});

		await insertMenuForRestaurant(ctx, {
			restaurantId: id,
			name: args.slug,
			userId,
		});

		return [id, null];
	},
});

export const update = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		name: v.optional(v.string()),
		slug: v.optional(v.string()),
		description: v.optional(v.string()),
		currency: v.optional(v.string()),
		timezone: v.optional(v.string()),
		defaultLanguage: v.optional(v.string()),
		supportedLanguages: v.optional(v.array(v.string())),
		orderDayStartMinutesFromMidnight: v.optional(v.number()),
		organizationId: v.id(TABLE.ORGANIZATIONS),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<
		Id<"restaurants">,
		AuthErrors | NotFoundErrorObject | UserInputValidationErrorObject
	> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) return [null, new NotFoundError("Restaurant not found").toObject()];
		if (restaurant.deletedAt != null) {
			return [null, new NotFoundError("Restaurant not found").toObject()];
		}

		const [, permErr] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (permErr) return [null, permErr];

		if (
			args.organizationId !== undefined &&
			args.organizationId !== restaurant.organizationId &&
			!(await isAdmin(ctx, userId))
		) {
			return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
		}

		if (
			args.orderDayStartMinutesFromMidnight !== undefined &&
			(args.orderDayStartMinutesFromMidnight < 0 ||
				args.orderDayStartMinutesFromMidnight > 1439)
		) {
			return [
				null,
				new UserInputValidationError({
					fields: [
						{
							field: "orderDayStartMinutesFromMidnight",
							message: "Order day start must be between 0 and 1439 minutes from midnight",
						},
					],
				}).toObject(),
			];
		}

		if (args.slug && args.slug !== restaurant.slug) {
			const existing = await ctx.db
				.query(TABLE.RESTAURANTS)
				.withIndex("by_slug", (q) => q.eq("slug", args.slug!))
				.first();
			if (existing && existing._id !== args.restaurantId && existing.deletedAt == null) {
				return [
					null,
					new UserInputValidationError({
						fields: [{ field: "slug", message: "This slug is already taken" }],
					}).toObject(),
				];
			}
		}

		await ctx.db.patch(args.restaurantId, {
			...(args.name !== undefined && { name: args.name }),
			...(args.slug !== undefined && { slug: args.slug }),
			...(args.description !== undefined && { description: args.description }),
			...(args.currency !== undefined && { currency: args.currency }),
			...(args.timezone !== undefined && { timezone: args.timezone }),
			...(args.defaultLanguage !== undefined && { defaultLanguage: args.defaultLanguage }),
			...(args.supportedLanguages !== undefined && { supportedLanguages: args.supportedLanguages }),
			...(args.orderDayStartMinutesFromMidnight !== undefined && {
				orderDayStartMinutesFromMidnight: args.orderDayStartMinutesFromMidnight,
			}),
			...(args.organizationId !== undefined && { organizationId: args.organizationId }),
			...stampUpdated(userId),
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESTAURANTS,
			aggregateId: String(args.restaurantId),
			eventType: "restaurants.updated",
			payload: args,
			userId,
		});

		return [args.restaurantId, null];
	},
});

export const toggleActive = mutation({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async function (ctx, args): AsyncReturn<boolean, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) return [null, new NotFoundError("Restaurant not found").toObject()];
		if (restaurant.deletedAt != null) {
			return [null, new NotFoundError("Restaurant not found").toObject()];
		}

		const [, permErr] = await requireRestaurantOwnerOrAdmin(ctx, userId, args.restaurantId);
		if (permErr) return [null, permErr];

		const newState = !restaurant.isActive;
		await ctx.db.patch(args.restaurantId, { isActive: newState, ...stampUpdated(userId) });
		return [newState, null];
	},
});

export const getByOwner = query({
	handler: async function (ctx): AsyncReturn<Doc<"restaurants">[], AuthErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const restaurants = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_owner", (q) => q.eq("ownerId", userId))
			.collect();

		return [restaurants.filter((r) => r.deletedAt == null), null];
	},
});

export const getPaymentsEnabled = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant || restaurant.deletedAt != null) return false;
		return restaurant.isActive === true && restaurant.stripeOnboardingComplete === true;
	},
});

export const getManageableForStripe = query({
	handler: async function (ctx): AsyncReturn<Doc<"restaurants">[], AuthErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const userIsAdmin = await isAdmin(ctx, userId);
		if (userIsAdmin) {
			const all = await ctx.db.query(TABLE.RESTAURANTS).collect();
			return [all.filter((r) => r.deletedAt == null), null];
		}

		const ownedRestaurants = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_owner", (q) => q.eq("ownerId", userId))
			.collect();
		return [ownedRestaurants.filter((r) => r.deletedAt == null), null];
	},
});

export const getBySlug = query({
	args: { slug: v.string() },
	handler: async (ctx, args) => {
		const r = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_slug", (q) => q.eq("slug", args.slug))
			.first();
		if (!r || r.deletedAt != null) return null;
		return r;
	},
});

export const getStripeStatus = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<
		{ stripeAccountId: string | undefined; stripeOnboardingComplete: boolean },
		AuthErrors | NotFoundErrorObject
	> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant || restaurant.deletedAt != null) {
			return [null, new NotFoundError("Restaurant not found").toObject()];
		}

		const [, permErr] = await requireRestaurantOwnerOrAdmin(ctx, userId, args.restaurantId);
		if (permErr) return [null, permErr];

		return [
			{
				stripeAccountId: restaurant.stripeAccountId,
				stripeOnboardingComplete: restaurant.stripeOnboardingComplete ?? false,
			},
			null,
		];
	},
});

/** Stable ordering for admin lists and client fallbacks: newest activity first. */
function sortRestaurantsForAdminList(restaurants: Doc<"restaurants">[]): Doc<"restaurants">[] {
	return [...restaurants].sort((a, b) => {
		if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
		return b._creationTime - a._creationTime;
	});
}

/**
 * Restaurants the user may use in admin (switcher, scoped queries): owned venues,
 * org-level owner expansion, and active restaurant member assignments.
 */
async function collectAccessibleRestaurantsForAdmin(
	ctx: QueryCtx,
	userId: string
): Promise<Doc<"restaurants">[]> {
	const seen = new Set<Id<"restaurants">>();
	const out: Doc<"restaurants">[] = [];

	const push = (r: Doc<"restaurants"> | null) => {
		if (!r || r.deletedAt != null || seen.has(r._id)) return;
		seen.add(r._id);
		out.push(r);
	};

	const owned = await ctx.db
		.query(TABLE.RESTAURANTS)
		.withIndex("by_owner", (q) => q.eq("ownerId", userId))
		.collect();
	for (const r of owned) push(r);

	const userRoleRows = await fetchUserRoleRecordsByUserId(ctx, userId);
	for (const row of userRoleRows) {
		const roles = row.roles ?? [];
		if (!roles.includes(USER_ROLES.OWNER) || !row.organizationId) continue;
		const orgId = row.organizationId as Id<"organizations">;
		const orgRestaurants = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_organization", (q) => q.eq("organizationId", orgId))
			.collect();
		for (const r of orgRestaurants) push(r);
	}

	const memberRows = await ctx.db
		.query(TABLE.RESTAURANT_MEMBERS)
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.collect();

	for (const m of memberRows) {
		if (!m.isActive) continue;
		if (
			m.role !== RESTAURANT_MEMBER_ROLE.MANAGER &&
			m.role !== RESTAURANT_MEMBER_ROLE.EMPLOYEE
		) {
			continue;
		}
		const r = await ctx.db.get(m.restaurantId);
		push(r);
	}

	return sortRestaurantsForAdminList(out);
}

/**
 * Soft-deleted restaurants the user may restore (admin, document owner, or org-level owner).
 * Excludes restaurant-scoped managers/employees.
 */
async function collectSoftDeletedForOwnerOrAdmin(
	ctx: QueryCtx,
	userId: string
): Promise<Doc<"restaurants">[]> {
	const seen = new Set<Id<"restaurants">>();
	const out: Doc<"restaurants">[] = [];

	const push = (r: Doc<"restaurants"> | null) => {
		if (!r || r.deletedAt == null || seen.has(r._id)) return;
		seen.add(r._id);
		out.push(r);
	};

	const owned = await ctx.db
		.query(TABLE.RESTAURANTS)
		.withIndex("by_owner", (q) => q.eq("ownerId", userId))
		.collect();
	for (const r of owned) push(r);

	const userRoleRows = await fetchUserRoleRecordsByUserId(ctx, userId);
	for (const row of userRoleRows) {
		const roles = row.roles ?? [];
		if (!roles.includes(USER_ROLES.OWNER) || !row.organizationId) continue;
		const orgId = row.organizationId as Id<"organizations">;
		const orgRestaurants = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_organization", (q) => q.eq("organizationId", orgId))
			.collect();
		for (const r of orgRestaurants) push(r);
	}

	return sortRestaurantsForAdminList(out);
}

export const getAll = query({
	handler: async function (ctx): AsyncReturn<Doc<"restaurants">[], AuthErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const userIsAdmin = await isAdmin(ctx, userId);
		if (userIsAdmin) {
			const all = await ctx.db.query(TABLE.RESTAURANTS).collect();
			const active = all.filter((r) => r.deletedAt == null);
			return [sortRestaurantsForAdminList(active), null];
		}

		const list = await collectAccessibleRestaurantsForAdmin(ctx, userId);
		return [list, null];
	},
});

export const getDeletedForAdmin = query({
	handler: async function (ctx): AsyncReturn<Doc<"restaurants">[], AuthErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const userIsAdmin = await isAdmin(ctx, userId);
		if (userIsAdmin) {
			const all = await ctx.db.query(TABLE.RESTAURANTS).collect();
			const deleted = all.filter((r) => r.deletedAt != null);
			return [sortRestaurantsForAdminList(deleted), null];
		}

		const list = await collectSoftDeletedForOwnerOrAdmin(ctx, userId);
		return [list, null];
	},
});
