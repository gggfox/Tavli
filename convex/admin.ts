/**
 * Admin-only queries and mutations for user management.
 */
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "@/global/types/errors";
import { AsyncReturn } from "@/global/types/types";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUserId, requireAdminRole } from "./_util/auth";
import { findExistingEventByKey, findExistingEventByKeyAndType } from "./_util/idempotency";
import type { UserRoleDoc } from "./constants";
import { TABLE } from "./constants";

/**
 * Get current user's roles.
 * Returns empty array if user has no roles assigned.
 */
type GetCurrentUserRolesErrors = NotAuthenticatedErrorObject;

export const getCurrentUserRoles = query({
	handler: async function (ctx): AsyncReturn<string[], GetCurrentUserRolesErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) {
			return [null, error];
		}
		const userRole = await ctx.db
			.query(TABLE.USER_ROLES)
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();

		return [userRole?.roles ?? [], null];
	},
});

/**
 * Get all users with their roles (admin only).
 * Returns user roles data for the admin dashboard.
 */
type GetAllUsersErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

export const getAllUsers = query({
	handler: async function (ctx): AsyncReturn<UserRoleDoc[], GetAllUsersErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) {
			return [null, error];
		}
		const [_, error2] = await requireAdminRole(ctx, userId);
		if (error2) {
			return [null, error2];
		}

		const userRoles = await ctx.db.query(TABLE.USER_ROLES).collect();

		return [
			userRoles.map((user) => ({
				_id: user._id,
				_creationTime: user._creationTime,
				userId: user.userId,
				roles: user.roles,
				organizationId: user.organizationId,
				createdAt: user.createdAt,
				updatedAt: user.updatedAt,
			})),
			null,
		];
	},
});

/**
 * Update user roles (admin only).
 */
type UpdateUserRolesErrors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| NotFoundErrorObject
	| UserInputValidationErrorObject;

export const updateUserRoles = mutation({
	args: {
		userId: v.string(),
		roles: v.array(v.union(v.literal("admin"), v.literal("seller"), v.literal("buyer"))),
		idempotencyKey: v.optional(v.string()),
	},
	handler: async function (ctx, args): AsyncReturn<string, UpdateUserRolesErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) {
			return [null, error];
		}
		const [_, error2] = await requireAdminRole(ctx, userId);
		if (error2) {
			return [null, error2];
		}

		// Validation: roles array must not be empty
		if (args.roles.length === 0) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "roles", message: "At least one role is required" }],
				}).toObject(),
			];
		}

		// Validation: check for duplicate roles
		const uniqueRoles = new Set(args.roles);
		if (uniqueRoles.size !== args.roles.length) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "roles", message: "Duplicate roles are not allowed" }],
				}).toObject(),
			];
		}

		const existingUser = await ctx.db
			.query(TABLE.USER_ROLES)
			.withIndex("by_user", (q) => q.eq("userId", args.userId))
			.first();

		if (!existingUser) {
			return [null, new NotFoundError("User not found").toObject()];
		}

		// Check idempotency
		if (args.idempotencyKey) {
			const [existing, existingError] = await findExistingEventByKey(
				ctx,
				TABLE.USER_ROLES,
				existingUser._id,
				args.idempotencyKey
			);

			if (existingError && existingError.name !== "NOT_FOUND") {
				return [null, existingError];
			}

			if (existing) {
				return [existingUser._id, null];
			}
		}

		const now = Date.now();
		await ctx.db.patch(existingUser._id, {
			roles: args.roles,
			updatedAt: now,
		});

		return [existingUser._id, null];
	},
});

/**
 * Create a new user role entry (admin only).
 * Used for setting up roles for new users.
 */
type CreateUserRoleErrors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| NotFoundErrorObject
	| UserInputValidationErrorObject;

export const createUserRole = mutation({
	args: {
		userId: v.string(),
		roles: v.array(v.union(v.literal("admin"), v.literal("seller"), v.literal("buyer"))),
		organizationId: v.optional(v.string()),
		idempotencyKey: v.optional(v.string()),
	},
	handler: async function (ctx, args): AsyncReturn<string, CreateUserRoleErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) {
			return [null, error];
		}
		const [_, error2] = await requireAdminRole(ctx, userId);
		if (error2) {
			return [null, error2];
		}

		// Validation: roles array must not be empty
		if (args.roles.length === 0) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "roles", message: "At least one role is required" }],
				}).toObject(),
			];
		}

		// Validation: check for duplicate roles
		const uniqueRoles = new Set(args.roles);
		if (uniqueRoles.size !== args.roles.length) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "roles", message: "Duplicate roles are not allowed" }],
				}).toObject(),
			];
		}

		// Check if user already has roles
		const existingUser = await ctx.db
			.query(TABLE.USER_ROLES)
			.withIndex("by_user", (q) => q.eq("userId", args.userId))
			.first();

		if (existingUser) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "userId", message: "User already has roles assigned" }],
				}).toObject(),
			];
		}

		// Check idempotency
		if (args.idempotencyKey) {
			const [existing, existingError] = await findExistingEventByKeyAndType(
				ctx,
				TABLE.USER_ROLES,
				args.idempotencyKey
			);

			if (existingError && existingError.name !== "NOT_FOUND") {
				return [null, existingError];
			}

			if (existing) {
				return [existing.aggregateId, null];
			}
		}

		const now = Date.now();
		const roleId = await ctx.db.insert(TABLE.USER_ROLES, {
			userId: args.userId,
			roles: args.roles,
			organizationId: args.organizationId,
			createdAt: now,
			updatedAt: now,
		});

		return [roleId, null];
	},
});

/**
 * Delete user roles (admin only).
 * Removes a user's role entry from the system.
 */
type DeleteUserRoleErrors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| NotFoundErrorObject
	| UserInputValidationErrorObject;

export const deleteUserRole = mutation({
	args: {
		userId: v.string(),
		idempotencyKey: v.optional(v.string()),
	},
	handler: async function (ctx, args): AsyncReturn<void, DeleteUserRoleErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) {
			return [null, error];
		}
		const [_, error2] = await requireAdminRole(ctx, userId);
		if (error2) {
			return [null, error2];
		}

		// Prevent admin from deleting their own roles
		if (args.userId === userId) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "userId", message: "Cannot delete your own roles" }],
				}).toObject(),
			];
		}

		const existingUser = await ctx.db
			.query(TABLE.USER_ROLES)
			.withIndex("by_user", (q) => q.eq("userId", args.userId))
			.first();

		if (!existingUser) {
			return [null, new NotFoundError("User not found").toObject()];
		}

		// Check idempotency
		if (args.idempotencyKey) {
			const [existing, existingError] = await findExistingEventByKey(
				ctx,
				TABLE.USER_ROLES,
				existingUser._id,
				args.idempotencyKey
			);

			if (existingError && existingError.name !== "NOT_FOUND") {
				return [null, existingError];
			}

			if (existing) {
				return [undefined, null];
			}
		}

		await ctx.db.delete(existingUser._id);

		return [undefined, null];
	},
});

/**
 * Self-assign admin role (development/testing only).
 * This allows any authenticated user to assign themselves admin role.
 * In production, this should be restricted or removed.
 */
type SelfAssignAdminRoleErrors = NotAuthenticatedErrorObject | NotFoundErrorObject;

export const selfAssignAdminRole = mutation({
	args: {
		idempotencyKey: v.optional(v.string()),
	},
	handler: async function (ctx, args): AsyncReturn<string, SelfAssignAdminRoleErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) {
			return [null, error];
		}

		// Check if user already has roles
		const existingUser = await ctx.db
			.query(TABLE.USER_ROLES)
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();

		// Check idempotency
		if (args.idempotencyKey) {
			if (existingUser) {
				const [existing, existingError] = await findExistingEventByKey(
					ctx,
					TABLE.USER_ROLES,
					existingUser._id,
					args.idempotencyKey
				);

				if (existingError && existingError.name !== "NOT_FOUND") {
					return [null, existingError];
				}

				if (existing) {
					return [existingUser._id, null];
				}
			} else {
				const [existing, existingError] = await findExistingEventByKeyAndType(
					ctx,
					TABLE.USER_ROLES,
					args.idempotencyKey
				);

				if (existingError && existingError.name !== "NOT_FOUND") {
					return [null, existingError];
				}

				if (existing) {
					return [existing.aggregateId, null];
				}
			}
		}

		if (existingUser) {
			// Update existing roles to include admin if not already present
			if (existingUser.roles.includes("admin")) {
				return [existingUser._id, null]; // Already has admin role
			}

			const now = Date.now();
			await ctx.db.patch(existingUser._id, {
				roles: [...existingUser.roles, "admin"],
				updatedAt: now,
			});

			return [existingUser._id, null];
		}

		// Create new role entry with admin role
		const now = Date.now();
		const roleId = await ctx.db.insert(TABLE.USER_ROLES, {
			userId: userId,
			roles: ["admin"],
			createdAt: now,
			updatedAt: now,
		});

		return [roleId, null];
	},
});
