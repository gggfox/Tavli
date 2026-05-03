/**
 * Role-based access control helpers.
 * These helpers validate user roles before allowing actions.
 *
 * Error messages have code format (e.g., "ERROR_ADMIN_ROLE_REQUIRED") used instead of detailed messages to:
 * 1. Prevent exposing internal architecture to users
 * 2. Allow i18n-compatible error handling on the frontend
 *
 * Admins have implicit access to all role-specific functionalities.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "../_generated/server";
import {
	RESTAURANT_MEMBER_ROLE,
	TABLE,
	USER_ROLES,
	type UserRole,
} from "../constants";

import {
	NotAuthenticatedError,
	NotAuthenticatedErrorObject,
	NotAuthorizedError,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
} from "../_shared/errors";
import { AsyncReturn } from "../_shared/types";

/**
 * Error messages for role-related errors.
 * These codes are safe to expose to clients and can be mapped to i18n keys.
 */
export const RoleErrorMessages = {
	ADMIN_REQUIRED: "ERROR_ADMIN_ROLE_REQUIRED",
	OWNER_REQUIRED: "ERROR_OWNER_ROLE_REQUIRED",
	MANAGER_REQUIRED: "ERROR_MANAGER_ROLE_REQUIRED",
	CUSTOMER_REQUIRED: "ERROR_CUSTOMER_ROLE_REQUIRED",
	EMPLOYEE_REQUIRED: "ERROR_EMPLOYEE_ROLE_REQUIRED",
	INSUFFICIENT_PERMISSIONS: "ERROR_INSUFFICIENT_ROLES",
} as const;

export type RoleErrorMessage = (typeof RoleErrorMessages)[keyof typeof RoleErrorMessages];

/**
 * Database context type for role operations.
 */
type RoleDbContext = { db: DatabaseReader | DatabaseWriter };

/**
 * Helper to get user roles from the database.
 */
async function fetchUserRoles(ctx: RoleDbContext, userId: string): Promise<UserRole[]> {
	const userRole = await fetchUserRoleRecord(ctx, userId);
	return userRole?.roles ?? [];
}

export async function fetchUserRoleRecord(
	ctx: RoleDbContext,
	userId: string
): Promise<Doc<"userRoles"> | null> {
	const userRole = await ctx.db
		.query(TABLE.USER_ROLES)
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.first();

	return userRole;
}

/** All `userRoles` rows for this user (schema allows more than one per `userId`). */
export async function fetchUserRoleRecordsByUserId(
	ctx: RoleDbContext,
	userId: string
): Promise<Doc<"userRoles">[]> {
	return await ctx.db
		.query(TABLE.USER_ROLES)
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.collect();
}

function someRowHasAdmin(rows: Doc<"userRoles">[]): boolean {
	return rows.some((r) => (r.roles ?? []).includes(USER_ROLES.ADMIN));
}

function someRowIsOrgOwnerForRestaurant(
	rows: Doc<"userRoles">[],
	restaurant: Doc<"restaurants">
): boolean {
	return rows.some(
		(r) =>
			(r.roles ?? []).includes(USER_ROLES.OWNER) &&
			orgIdsMatch(r.organizationId, restaurant.organizationId)
	);
}

/** Active membership row for a user at a restaurant (manager or employee). */
export async function getRestaurantMembership(
	ctx: RoleDbContext,
	userId: string,
	restaurantId: Id<"restaurants">
): Promise<Doc<"restaurantMembers"> | null> {
	return await ctx.db
		.query(TABLE.RESTAURANT_MEMBERS)
		.withIndex("by_restaurant_user", (q) =>
			q.eq("restaurantId", restaurantId).eq("userId", userId)
		)
		.first();
}

function orgIdsMatch(
	orgIdA: string | undefined,
	orgIdB: Id<"organizations">
): boolean {
	if (!orgIdA) return false;
	return orgIdA === orgIdB;
}

/** Primary account on the restaurant row (creator / billing owner). */
export function isRestaurantDocumentOwner(
	restaurant: Doc<"restaurants">,
	userId: string
): boolean {
	return restaurant.ownerId === userId;
}

/**
 * Admin, document owner (`restaurants.ownerId`), org-level owner for this
 * restaurant's org, or active restaurant-scoped manager.
 */
export async function requireRestaurantManagerOrAbove(
	ctx: RoleDbContext,
	userId: string,
	restaurantId: Id<"restaurants">
): AsyncReturn<Doc<"restaurants">, RestaurantAccessErrors> {
	const restaurant = await ctx.db.get(restaurantId);
	if (!restaurant) {
		return [null, new NotFoundError("Restaurant not found").toObject()];
	}

	if (restaurant.deletedAt != null) {
		return [null, new NotFoundError("Restaurant not found").toObject()];
	}

	const userRoleRows = await fetchUserRoleRecordsByUserId(ctx, userId);
	if (someRowHasAdmin(userRoleRows)) {
		return [restaurant, null];
	}

	if (isRestaurantDocumentOwner(restaurant, userId)) {
		return [restaurant, null];
	}

	if (someRowIsOrgOwnerForRestaurant(userRoleRows, restaurant)) {
		return [restaurant, null];
	}

	const member = await getRestaurantMembership(ctx, userId, restaurantId);
	if (member?.isActive && member.role === RESTAURANT_MEMBER_ROLE.MANAGER) {
		return [restaurant, null];
	}

	return [null, new NotAuthorizedError(RoleErrorMessages.MANAGER_REQUIRED).toObject()];
}

/**
 * Check if a user has a specific role.
 */
export async function hasRole(
	ctx: RoleDbContext,
	userId: string,
	role: UserRole
): Promise<boolean> {
	const roles = await fetchUserRoles(ctx, userId);
	return roles.includes(role);
}

/**
 * Check if a user is an admin.
 */
export async function isAdmin(ctx: RoleDbContext, userId: string): Promise<boolean> {
	const roles = await fetchUserRoles(ctx, userId);
	return roles.includes(USER_ROLES.ADMIN);
}

/**
 * Require admin role. Throws if user doesn't have admin role.
 */
export async function requireAdminRole(
	ctx: RoleDbContext,
	userId: string
): AsyncReturn<null, NotAuthorizedErrorObject> {
	const roles = await fetchUserRoles(ctx, userId);

	if (!roles.includes(USER_ROLES.ADMIN)) {
		return [null, new NotAuthorizedError(RoleErrorMessages.ADMIN_REQUIRED).toObject()];
	}

	return [null, null];
}

/**
 * Require manager role. Returns error if user doesn't have manager, owner, or admin role.
 * Admins and owners automatically pass this check.
 */
export async function requireManagerRole(
	ctx: RoleDbContext,
	userId: string
): AsyncReturn<null, NotAuthorizedErrorObject> {
	const roles = await fetchUserRoles(ctx, userId);

	if (
		roles.includes(USER_ROLES.ADMIN) ||
		roles.includes(USER_ROLES.OWNER) ||
		roles.includes(USER_ROLES.MANAGER)
	) {
		return [null, null];
	}

	return [null, new NotAuthorizedError(RoleErrorMessages.MANAGER_REQUIRED).toObject()];
}

/**
 * Require owner role. Returns error if user doesn't have owner role.
 * Admins automatically pass this check.
 */
export async function requireOwnerRole(
	ctx: RoleDbContext,
	userId: string
): AsyncReturn<null, NotAuthorizedErrorObject> {
	const roles = await fetchUserRoles(ctx, userId);

	if (roles.includes(USER_ROLES.ADMIN)) {
		return [null, null];
	}

	if (!roles.includes(USER_ROLES.OWNER)) {
		return [null, new NotAuthorizedError(RoleErrorMessages.OWNER_REQUIRED).toObject()];
	}

	return [null, null];
}

/**
 * Require owner, manager, or employee role. Returns error if user doesn't have any of these.
 * Admins automatically pass this check.
 */
export async function requireStaffRole(
	ctx: RoleDbContext,
	userId: string
): AsyncReturn<null, NotAuthorizedErrorObject> {
	const roles = await fetchUserRoles(ctx, userId);

	if (
		roles.includes(USER_ROLES.ADMIN) ||
		roles.includes(USER_ROLES.OWNER) ||
		roles.includes(USER_ROLES.MANAGER) ||
		roles.includes(USER_ROLES.EMPLOYEE)
	) {
		return [null, null];
	}

	return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
}

/** @deprecated Use requireStaffRole instead */
export const requireOwnerOrEmployeeRole = requireStaffRole;

/**
 * Get all roles for a user.
 */
export async function getUserRoles(ctx: RoleDbContext, userId: string): Promise<UserRole[]> {
	return fetchUserRoles(ctx, userId);
}

type RestaurantAccessErrors = NotAuthorizedErrorObject | NotFoundErrorObject;

type RestaurantAccessScope = "owner_admin" | "staff";

async function requireRestaurantAccess(
	ctx: RoleDbContext,
	userId: string,
	restaurantId: Id<"restaurants">,
	scope: RestaurantAccessScope
): AsyncReturn<Doc<"restaurants">, RestaurantAccessErrors> {
	const restaurant = await ctx.db.get(restaurantId);
	if (!restaurant) {
		return [null, new NotFoundError("Restaurant not found").toObject()];
	}

	if (restaurant.deletedAt != null && scope === "staff") {
		return [null, new NotFoundError("Restaurant not found").toObject()];
	}

	const userRoleRows = await fetchUserRoleRecordsByUserId(ctx, userId);
	if (someRowHasAdmin(userRoleRows)) {
		return [restaurant, null];
	}

	if (isRestaurantDocumentOwner(restaurant, userId)) {
		return [restaurant, null];
	}

	if (scope === "owner_admin" && someRowIsOrgOwnerForRestaurant(userRoleRows, restaurant)) {
		return [restaurant, null];
	}

	if (scope === "staff") {
		if (someRowIsOrgOwnerForRestaurant(userRoleRows, restaurant)) {
			return [restaurant, null];
		}

		const member = await getRestaurantMembership(ctx, userId, restaurantId);
		if (
			member?.isActive &&
			(member.role === RESTAURANT_MEMBER_ROLE.MANAGER ||
				member.role === RESTAURANT_MEMBER_ROLE.EMPLOYEE)
		) {
			return [restaurant, null];
		}
	}

	return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
}

/**
 * Admin, document owner (`restaurants.ownerId`), or org-level owner for this
 * restaurant's organization.
 */
export async function requireRestaurantOwnerOrAdmin(
	ctx: RoleDbContext,
	userId: string,
	restaurantId: Id<"restaurants">
): AsyncReturn<Doc<"restaurants">, RestaurantAccessErrors> {
	return requireRestaurantAccess(ctx, userId, restaurantId, "owner_admin");
}

export async function requireRestaurantStaffAccess(
	ctx: RoleDbContext,
	userId: string,
	restaurantId: Id<"restaurants">
): AsyncReturn<Doc<"restaurants">, RestaurantAccessErrors> {
	return requireRestaurantAccess(ctx, userId, restaurantId, "staff");
}

/**
 * Helper to get the authenticated user's identity.
 * Throws an error if the user is not authenticated.
 */

type UserId = string & { __brand?: "UserId" };

interface Subject {
	subject: UserId;
}

interface AuthenticationContext {
	auth: { getUserIdentity: () => Promise<Subject | null> };
}
export async function getCurrentUserId(
	ctx: AuthenticationContext
): Promise<[UserId, null] | [null, NotAuthenticatedErrorObject]> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		return [null, new NotAuthenticatedError().toObject()];
	}
	return [identity.subject, null];
}
