/**
 * Role-based access control helpers.
 * These helpers validate user roles before allowing actions.
 *
 * Error messages have code format (e.g., "ERROR_ADMIN_ROLE_REQUIRED") used instead of detailed messages to:
 * 1. Prevent exposing internal architecture to users
 * 2. Allow i18n-compatible error handling on the frontend
 *
 * Admins have implicit access to all buyer and seller functionalities.
 */
import type { DatabaseReader, DatabaseWriter } from "../_generated/server";
import { TABLE, USER_ROLES, UserRole } from "../constants";

import {
	NotAuthenticatedError,
	NotAuthenticatedErrorObject,
	NotAuthorizedError,
	NotAuthorizedErrorObject,
} from "../_shared/errors";
import { AsyncReturn } from "../_shared/types";

/**
 * Error messages for role-related errors.
 * These codes are safe to expose to clients and can be mapped to i18n keys.
 */
export const RoleErrorMessages = {
	ADMIN_REQUIRED: "ERROR_ADMIN_ROLE_REQUIRED",
	SELLER_REQUIRED: "ERROR_SELLER_ROLE_REQUIRED",
	BUYER_REQUIRED: "ERROR_BUYER_ROLE_REQUIRED",
	OWNER_REQUIRED: "ERROR_OWNER_ROLE_REQUIRED",
	STAFF_REQUIRED: "ERROR_STAFF_ROLE_REQUIRED",
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
	const userRole = await ctx.db
		.query(TABLE.USER_ROLES)
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.first();

	return userRole?.roles ?? [];
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
 * Require seller role. Returns error if user doesn't have seller role.
 * Note: Admins automatically pass this check as they have implicit seller access.
 */
export async function requireSellerRole(
	ctx: RoleDbContext,
	userId: string
): AsyncReturn<null, NotAuthorizedErrorObject> {
	const roles = await fetchUserRoles(ctx, userId);

	// Admins have implicit access to seller functionalities
	if (roles.includes(USER_ROLES.ADMIN)) {
		return [null, null];
	}

	if (!roles.includes(USER_ROLES.SELLER)) {
		return [null, new NotAuthorizedError(RoleErrorMessages.SELLER_REQUIRED).toObject()];
	}

	return [null, null];
}

/**
 * Require buyer role. Returns error if user doesn't have buyer role.
 * Note: Admins automatically pass this check as they have implicit buyer access.
 */
export async function requireBuyerRole(
	ctx: RoleDbContext,
	userId: string
): AsyncReturn<null, NotAuthorizedErrorObject> {
	const roles = await fetchUserRoles(ctx, userId);

	// Admins have implicit access to buyer functionalities
	if (roles.includes(USER_ROLES.ADMIN)) {
		return [null, null];
	}

	if (!roles.includes(USER_ROLES.BUYER)) {
		return [null, new NotAuthorizedError(RoleErrorMessages.BUYER_REQUIRED).toObject()];
	}

	return [null, null];
}

/**
 * Require admin or seller role. Returns error if user doesn't have either role.
 */
export async function requireAdminOrSellerRole(
	ctx: RoleDbContext,
	userId: string
): AsyncReturn<null, NotAuthorizedErrorObject> {
	const roles = await fetchUserRoles(ctx, userId);

	if (!roles.includes(USER_ROLES.ADMIN) && !roles.includes(USER_ROLES.SELLER)) {
		return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
	}

	return [null, null];
}

/**
 * Require admin or buyer role. Returns error if user doesn't have either role.
 */
export async function requireAdminOrBuyerRole(
	ctx: RoleDbContext,
	userId: string
): AsyncReturn<null, NotAuthorizedErrorObject> {
	const roles = await fetchUserRoles(ctx, userId);

	if (!roles.includes(USER_ROLES.ADMIN) && !roles.includes(USER_ROLES.BUYER)) {
		return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
	}

	return [null, null];
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
 * Require owner or staff role. Returns error if user doesn't have either role.
 * Admins automatically pass this check.
 */
export async function requireOwnerOrStaffRole(
	ctx: RoleDbContext,
	userId: string
): AsyncReturn<null, NotAuthorizedErrorObject> {
	const roles = await fetchUserRoles(ctx, userId);

	if (roles.includes(USER_ROLES.ADMIN)) {
		return [null, null];
	}

	if (!roles.includes(USER_ROLES.OWNER) && !roles.includes(USER_ROLES.STAFF)) {
		return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
	}

	return [null, null];
}

/**
 * Get all roles for a user.
 */
export async function getUserRoles(ctx: RoleDbContext, userId: string): Promise<UserRole[]> {
	return fetchUserRoles(ctx, userId);
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
