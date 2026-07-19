/**
 * Admin-only queries and mutations for user management.
 */
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import {
	ERROR_NAMES,
	IdempotencyKeyConflictErrorObject,
	NotAuthenticatedErrorObject,
	NotAuthorizedError,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { appendAuditEvent } from "./_util/audit";
import { getCurrentUserId, requireAdminRole } from "./_util/auth";
import { isAdminBootstrapEnabled, isDevRoleSwitcherEnabled } from "./_util/env";
import { findExistingEventByKey, findExistingEventByKeyAndType } from "./_util/idempotency";
import {
	ADMIN_BOOTSTRAP_REFUSAL,
	decideAdminBootstrap,
	normalizeBootstrapEmail,
} from "./adminHelpers";
import type { UserRoleDoc } from "./constants";
import { AUDIT_SYSTEM_USER_ID, TABLE } from "./constants";

export const DEV_ONLY_ERROR_MESSAGE = "ERROR_DEV_ENVIRONMENT_ONLY";

/**
 * Get current user's roles and optional organization scope from userRoles.
 */
type GetCurrentUserRolesErrors = NotAuthenticatedErrorObject;

export type CurrentUserRolesPayload = {
	roles: string[];
	organizationId?: string;
};

export const getCurrentUserRoles = query({
	handler: async function (ctx): AsyncReturn<CurrentUserRolesPayload, GetCurrentUserRolesErrors> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) {
			return [null, error];
		}
		const userRole = await ctx.db
			.query(TABLE.USER_ROLES)
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();

		return [
			{
				roles: userRole?.roles ?? [],
				organizationId: userRole?.organizationId,
			},
			null,
		];
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
				email: user.email,
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
		roles: v.array(
			v.union(
				v.literal("admin"),
				v.literal("owner"),
				v.literal("manager"),
				v.literal("customer"),
				v.literal("employee")
			)
		),
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
	| IdempotencyKeyConflictErrorObject
	| UserInputValidationErrorObject;

export const createUserRole = mutation({
	args: {
		userId: v.string(),
		roles: v.array(
			v.union(
				v.literal("admin"),
				v.literal("owner"),
				v.literal("manager"),
				v.literal("customer"),
				v.literal("employee")
			)
		),
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

			if (existingError?.name === ERROR_NAMES.IDEMPOTENCY_KEY_CONFLICT) {
				return [null, existingError];
			}

			if (existingError && existingError.name !== ERROR_NAMES.NOT_FOUND) {
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
	handler: async function (ctx, args): AsyncReturn<null, DeleteUserRoleErrors> {
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
				return [null, null];
			}
		}

		await ctx.db.delete(existingUser._id);

		return [null, null];
	},
});

/**
 * Set own roles to an arbitrary combination (development environment only).
 *
 * Available only when `CONVEX_ENV` is development **and**
 * `ENABLE_DEV_ROLE_SWITCHER` is explicitly set. In any other deployment this
 * returns NOT_AUTHORIZED so the dev-only role switcher in the UI cannot be used
 * to escalate privileges in staging/production.
 *
 * Inside dev we deliberately skip the admin-role check: switching to a
 * non-admin role would otherwise lock the user out of switching back, defeating
 * the point of the switcher.
 */
type DevSetOwnRolesErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

export const devSetOwnRoles = mutation({
	args: {
		roles: v.array(
			v.union(
				v.literal("admin"),
				v.literal("owner"),
				v.literal("manager"),
				v.literal("customer"),
				v.literal("employee")
			)
		),
	},
	handler: async function (ctx, args): AsyncReturn<string, DevSetOwnRolesErrors> {
		if (!isDevRoleSwitcherEnabled()) {
			return [null, new NotAuthorizedError(DEV_ONLY_ERROR_MESSAGE).toObject()];
		}

		const [userId, error] = await getCurrentUserId(ctx);
		if (error) {
			return [null, error];
		}

		const identity = await ctx.auth.getUserIdentity();
		const email = identity?.email ?? undefined;

		const existingUser = await ctx.db
			.query(TABLE.USER_ROLES)
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();

		const now = Date.now();
		const previousRoles = existingUser?.roles;

		let roleRecordId: string;

		if (existingUser) {
			await ctx.db.patch(existingUser._id, {
				roles: args.roles,
				email,
				updatedAt: now,
			});
			roleRecordId = existingUser._id;
		} else {
			roleRecordId = await ctx.db.insert(TABLE.USER_ROLES, {
				userId,
				email,
				roles: args.roles,
				createdAt: now,
				updatedAt: now,
			});
		}

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.USER_ROLES,
			aggregateId: roleRecordId,
			eventType: "userRoles.dev_set_own_roles",
			payload: { roles: args.roles, previousRoles },
			userId,
		});

		return [roleRecordId, null];
	},
});

/**
 * Guarded first-admin bootstrap (operator-only, ticket TAVLI-51).
 *
 * On a fresh production database there is no privileged caller to grant the
 * first org-level owner/admin, so every admin mutation refuses and
 * `/admin/restaurants` shows "Access Denied". This is the supported one-time
 * bootstrap: it promotes an EXISTING `userRoles` row — matched by email or
 * Clerk subject — to `owner` + `admin`, preserving any roles it already had.
 *
 * It is an `internalMutation`, so it is unreachable from the client/browser;
 * the only surfaces are `npx convex run` and the Convex dashboard, i.e. an
 * operator who already has deployment access. It fails closed via
 * `decideAdminBootstrap`:
 *   - `ALLOW_ADMIN_BOOTSTRAP` must be truthy (inert by default; unset it again
 *     right after use);
 *   - refuses if ANY owner/admin already exists (strictly first-admin);
 *   - refuses if the target user row does not exist (never creates users).
 *
 * See `documentation/internal-guides/deployment-and-secrets.md` →
 * "First-admin bootstrap" for the operator procedure.
 */
export const bootstrapFirstAdmin = internalMutation({
	args: {
		email: v.optional(v.string()),
		clerkSubject: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const email = args.email?.trim();
		const clerkSubject = args.clerkSubject?.trim();
		const hasEmail = email != null && email !== "";
		const hasSubject = clerkSubject != null && clerkSubject !== "";

		// Require exactly one selector so the lookup is unambiguous.
		if (hasEmail === hasSubject) {
			throw new UserInputValidationError({
				fields: [
					{
						field: "email/clerkSubject",
						message: "Provide exactly one of `email` or `clerkSubject`",
					},
				],
			});
		}

		const existingRoleRows = await ctx.db.query(TABLE.USER_ROLES).collect();

		let targetRow: (typeof existingRoleRows)[number] | null = null;
		if (hasSubject) {
			targetRow = existingRoleRows.find((row) => row.userId === clerkSubject) ?? null;
		} else if (hasEmail) {
			const normalized = normalizeBootstrapEmail(email);
			targetRow =
				existingRoleRows.find(
					(row) => row.email != null && normalizeBootstrapEmail(row.email) === normalized
				) ?? null;
		}

		const decision = decideAdminBootstrap({
			allowBootstrap: isAdminBootstrapEnabled(),
			existingRoleRows,
			targetRow,
		});

		if (!decision.ok) {
			if (decision.reason === ADMIN_BOOTSTRAP_REFUSAL.USER_NOT_FOUND) {
				throw new NotFoundError(decision.reason);
			}
			throw new NotAuthorizedError(decision.reason);
		}

		// `decision.ok` guarantees `targetRow` was non-null; re-narrow for the
		// type-checker while staying fail-closed if that ever regresses.
		if (!targetRow) {
			throw new NotFoundError(ADMIN_BOOTSTRAP_REFUSAL.USER_NOT_FOUND);
		}

		const now = Date.now();
		await ctx.db.patch(targetRow._id, {
			roles: decision.nextRoles,
			updatedAt: now,
			updatedBy: AUDIT_SYSTEM_USER_ID,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.USER_ROLES,
			aggregateId: targetRow._id,
			eventType: "userRoles.bootstrap_first_admin",
			payload: {
				roles: decision.nextRoles,
				previousRoles: decision.previousRoles,
				matchedBy: hasSubject ? "clerkSubject" : "email",
			},
			userId: AUDIT_SYSTEM_USER_ID,
		});

		return { ok: true as const, userRoleId: targetRow._id, roles: decision.nextRoles };
	},
});
