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
import { TABLE, USER_ROLES, UserRole } from "../constants";

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

async function fetchUserRoleRecord(
	ctx: RoleDbContext,
	userId: string
): Promise<Doc<"userRoles"> | null> {
	const userRole = await ctx.db
		.query(TABLE.USER_ROLES)
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.first();

	return userRole;
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

type RestaurantAccessContext = RoleDbContext;

async function requireRestaurantAccess(
	ctx: RestaurantAccessContext,
	userId: string,
	restaurantId: Id<"restaurants">,
	scope: RestaurantAccessScope
): AsyncReturn<Doc<"restaurants">, RestaurantAccessErrors> {
	const restaurant = await ctx.db.get(restaurantId);
	if (!restaurant) {
		return [null, new NotFoundError("Restaurant not found").toObject()];
	}

	const userRoleRecord = await fetchUserRoleRecord(ctx, userId);
	const roles = userRoleRecord?.roles ?? [];
	if (roles.includes(USER_ROLES.ADMIN)) {
		return [restaurant, null];
	}

	if (restaurant.ownerId === userId) {
		return [restaurant, null];
	}

	if (
		scope === "staff" &&
		userRoleRecord?.organizationId &&
		userRoleRecord.organizationId === restaurant.organizationId &&
		(roles.includes(USER_ROLES.OWNER) ||
			roles.includes(USER_ROLES.MANAGER) ||
			roles.includes(USER_ROLES.EMPLOYEE))
	) {
		return [restaurant, null];
	}

	return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
}

export async function requireRestaurantOwnerOrAdmin(
	ctx: RestaurantAccessContext,
	userId: string,
	restaurantId: Id<"restaurants">
): AsyncReturn<Doc<"restaurants">, RestaurantAccessErrors> {
	return requireRestaurantAccess(ctx, userId, restaurantId, "owner_admin");
}

export async function requireRestaurantStaffAccess(
	ctx: RestaurantAccessContext,
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
