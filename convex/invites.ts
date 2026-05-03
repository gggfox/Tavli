import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import {
	NotAuthenticatedError,
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
	fetchUserRoleRecord,
	getCurrentUserId,
	getRestaurantMembership,
	isAdmin,
	isRestaurantDocumentOwner,
	RoleErrorMessages,
} from "./_util/auth";
import {
	AUDIT_SYSTEM_USER_ID,
	INVITATION_STATUS,
	RESTAURANT_MEMBER_ROLE,
	TABLE,
	USER_ROLES,
} from "./constants";

type AuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

type DbCtx = { db: DatabaseReader };

async function assertOrgOwnerOrAdmin(
	ctx: DbCtx,
	userId: string,
	organizationId: Id<"organizations">
): AsyncReturn<null, NotAuthorizedErrorObject> {
	if (await isAdmin(ctx, userId)) return [null, null];
	const ur = await fetchUserRoleRecord(ctx, userId);
	if (ur?.roles.includes(USER_ROLES.OWNER) && ur?.organizationId === organizationId) {
		return [null, null];
	}
	return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
}

async function assertCanCreateInvitation(
	ctx: DbCtx,
	actorId: string,
	args: {
		organizationId: Id<"organizations">;
		role: typeof USER_ROLES.OWNER | typeof RESTAURANT_MEMBER_ROLE.MANAGER | typeof RESTAURANT_MEMBER_ROLE.EMPLOYEE;
		restaurantIds: Id<"restaurants">[];
	}
): AsyncReturn<null, NotAuthorizedErrorObject> {
	if (await isAdmin(ctx, actorId)) return [null, null];

	const ur = await fetchUserRoleRecord(ctx, actorId);
	const orgMatch = ur?.organizationId === args.organizationId;

	// Org-owner invites are platform-admin only (admins already returned above).
	if (args.role === USER_ROLES.OWNER) {
		return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
	}

	if (args.role === RESTAURANT_MEMBER_ROLE.MANAGER) {
		if (ur?.roles.includes(USER_ROLES.OWNER) && orgMatch) return [null, null];
		if (args.restaurantIds.length > 0) {
			let allDocumentOwned = true;
			for (const rid of args.restaurantIds) {
				const rest = await ctx.db.get(rid);
				if (
					!rest ||
					!isRestaurantDocumentOwner(rest, actorId) ||
					rest.organizationId !== args.organizationId
				) {
					allDocumentOwned = false;
					break;
				}
			}
			if (allDocumentOwned) return [null, null];
		}
		return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
	}

	// employee — org owner, org manager, document owner of each target restaurant, or active restaurant manager on every target restaurant
	if (ur?.roles.includes(USER_ROLES.OWNER) && orgMatch) return [null, null];
	if (ur?.roles.includes(USER_ROLES.MANAGER) && orgMatch) return [null, null];

	for (const rid of args.restaurantIds) {
		const rest = await ctx.db.get(rid);
		if (
			rest &&
			isRestaurantDocumentOwner(rest, actorId) &&
			rest.organizationId === args.organizationId
		) {
			continue;
		}
		const m = await getRestaurantMembership(ctx, actorId, rid);
		if (
			!m?.isActive ||
			m.role !== RESTAURANT_MEMBER_ROLE.MANAGER ||
			m.organizationId !== args.organizationId
		) {
			return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
		}
	}
	return [null, null];
}

/** Revoke / directory visibility: aligned with who may create comparable invites. */
export async function assertCanManageInvitation(
	ctx: DbCtx,
	actorId: string,
	invitation: Pick<Doc<"invitations">, "organizationId" | "role" | "restaurantIds">
): AsyncReturn<null, NotAuthorizedErrorObject> {
	if (await isAdmin(ctx, actorId)) return [null, null];

	const ur = await fetchUserRoleRecord(ctx, actorId);
	const orgMatch = ur?.organizationId === invitation.organizationId;

	if (invitation.role === USER_ROLES.OWNER) {
		if (ur?.roles.includes(USER_ROLES.OWNER) && orgMatch) return [null, null];
		return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
	}

	if (invitation.role === RESTAURANT_MEMBER_ROLE.MANAGER) {
		if (ur?.roles.includes(USER_ROLES.OWNER) && orgMatch) return [null, null];
		if (invitation.restaurantIds.length > 0) {
			let allDocumentOwned = true;
			for (const rid of invitation.restaurantIds) {
				const rest = await ctx.db.get(rid);
				if (
					!rest ||
					!isRestaurantDocumentOwner(rest, actorId) ||
					rest.organizationId !== invitation.organizationId
				) {
					allDocumentOwned = false;
					break;
				}
			}
			if (allDocumentOwned) return [null, null];
		}
		return [null, new NotAuthorizedError(RoleErrorMessages.INSUFFICIENT_PERMISSIONS).toObject()];
	}

	return assertCanCreateInvitation(ctx, actorId, {
		organizationId: invitation.organizationId,
		role: RESTAURANT_MEMBER_ROLE.EMPLOYEE,
		restaurantIds: invitation.restaurantIds,
	});
}

export const createInvitation = mutation({
	args: {
		organizationId: v.id(TABLE.ORGANIZATIONS),
		email: v.string(),
		role: v.union(
			v.literal(USER_ROLES.OWNER),
			v.literal(RESTAURANT_MEMBER_ROLE.MANAGER),
			v.literal(RESTAURANT_MEMBER_ROLE.EMPLOYEE)
		),
		restaurantIds: v.array(v.id(TABLE.RESTAURANTS)),
		expiresInMs: v.optional(v.number()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"invitations">, AuthErrors | UserInputValidationErrorObject> {
		const [actorId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		if (
			(args.role === RESTAURANT_MEMBER_ROLE.MANAGER ||
				args.role === RESTAURANT_MEMBER_ROLE.EMPLOYEE) &&
			args.restaurantIds.length === 0
		) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "restaurantIds", message: "Select at least one restaurant" }],
				}).toObject(),
			];
		}

		const [, permErr] = await assertCanCreateInvitation(ctx, actorId, {
			organizationId: args.organizationId,
			role: args.role,
			restaurantIds: args.restaurantIds,
		});
		if (permErr) return [null, permErr];

		const token = crypto.randomUUID();
		const now = Date.now();
		const ttl = args.expiresInMs ?? 7 * 24 * 60 * 60 * 1000;

		const id = await ctx.db.insert(TABLE.INVITATIONS, {
			token,
			email: normalizeEmail(args.email),
			organizationId: args.organizationId,
			role: args.role,
			restaurantIds: args.restaurantIds,
			invitedBy: actorId,
			status: INVITATION_STATUS.PENDING,
			expiresAt: now + ttl,
			createdAt: now,
			updatedAt: now,
			updatedBy: actorId,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.INVITATIONS,
			aggregateId: id,
			eventType: "invitations.created",
			payload: { email: args.email, role: args.role },
			userId: actorId,
		});

		await ctx.scheduler.runAfter(0, internal.inviteActions.sendInviteEmail, {
			invitationId: id,
		});

		return [id, null];
	},
});

export const acceptInvitation = mutation({
	args: { token: v.string() },
	handler: async function (
		ctx,
		args
	): AsyncReturn<
		{ ok: true },
		NotAuthenticatedErrorObject | NotFoundErrorObject | UserInputValidationErrorObject
	> {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return [null, new NotAuthenticatedError().toObject()];
		}
		const idRecord = identity as unknown as { email?: string; emailAddress?: string };
		const email =
			typeof idRecord.email === "string"
				? idRecord.email
				: typeof idRecord.emailAddress === "string"
					? idRecord.emailAddress
					: undefined;
		if (!email) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "email", message: "Your account must have an email to accept invites" }],
				}).toObject(),
			];
		}

		const userId = identity.subject;

		const invitation = await ctx.db
			.query(TABLE.INVITATIONS)
			.withIndex("by_token", (q) => q.eq("token", args.token))
			.first();

		if (!invitation) return [null, new NotFoundError("Invitation not found").toObject()];
		if (invitation.status !== INVITATION_STATUS.PENDING) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "token", message: "Invitation is no longer valid" }],
				}).toObject(),
			];
		}
		if (invitation.expiresAt < Date.now()) {
			await ctx.db.patch(invitation._id, {
				status: INVITATION_STATUS.EXPIRED,
				...stampUpdated(userId),
			});
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "token", message: "Invitation expired" }],
				}).toObject(),
			];
		}

		if (normalizeEmail(email) !== invitation.email) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "email", message: "Signed-in email does not match invitation" }],
				}).toObject(),
			];
		}

		const now = Date.now();

		if (invitation.role === USER_ROLES.OWNER) {
			const existing = await fetchUserRoleRecord(ctx, userId);
			const roles = new Set(existing?.roles ?? []);
			roles.add(USER_ROLES.OWNER);
			if (existing) {
				await ctx.db.patch(existing._id, {
					roles: [...roles],
					organizationId: invitation.organizationId,
					email: normalizeEmail(email),
					updatedAt: now,
					updatedBy: userId,
				});
			} else {
				await ctx.db.insert(TABLE.USER_ROLES, {
					userId,
					email: normalizeEmail(email),
					roles: [...roles],
					organizationId: invitation.organizationId,
					createdAt: now,
					updatedAt: now,
					updatedBy: userId,
				});
			}
		} else {
			const memberRole =
				invitation.role === RESTAURANT_MEMBER_ROLE.MANAGER
					? RESTAURANT_MEMBER_ROLE.MANAGER
					: RESTAURANT_MEMBER_ROLE.EMPLOYEE;

			for (const restaurantId of invitation.restaurantIds) {
				const restaurant = await ctx.db.get(restaurantId);
				if (!restaurant || restaurant.organizationId !== invitation.organizationId) continue;

				const dup = await ctx.db
					.query(TABLE.RESTAURANT_MEMBERS)
					.withIndex("by_restaurant_user", (q) =>
						q.eq("restaurantId", restaurantId).eq("userId", userId)
					)
					.first();
				if (dup) {
					await ctx.db.patch(dup._id, {
						role: memberRole,
						isActive: true,
						...stampUpdated(userId),
					});
				} else {
					await ctx.db.insert(TABLE.RESTAURANT_MEMBERS, {
						userId,
						restaurantId,
						organizationId: invitation.organizationId,
						role: memberRole,
						isActive: true,
						addedBy: invitation.invitedBy,
						createdAt: now,
						updatedAt: now,
						updatedBy: userId,
					});
				}
			}

			const ur = await fetchUserRoleRecord(ctx, userId);
			const sidebarRole =
				memberRole === RESTAURANT_MEMBER_ROLE.MANAGER
					? USER_ROLES.MANAGER
					: USER_ROLES.EMPLOYEE;
			const roles = new Set(ur?.roles ?? []);
			roles.add(sidebarRole);
			if (ur) {
				await ctx.db.patch(ur._id, {
					roles: [...roles],
					organizationId: invitation.organizationId,
					email: normalizeEmail(email),
					updatedAt: now,
					updatedBy: userId,
				});
			} else {
				await ctx.db.insert(TABLE.USER_ROLES, {
					userId,
					email: normalizeEmail(email),
					roles: [...roles],
					organizationId: invitation.organizationId,
					createdAt: now,
					updatedAt: now,
					updatedBy: userId,
				});
			}
		}

		await ctx.db.patch(invitation._id, {
			status: INVITATION_STATUS.ACCEPTED,
			acceptedAt: now,
			acceptedByUserId: userId,
			...stampUpdated(userId),
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.INVITATIONS,
			aggregateId: invitation._id,
			eventType: "invitations.accepted",
			payload: { userId },
			userId,
		});

		return [{ ok: true }, null];
	},
});

export const revokeInvitation = mutation({
	args: { invitationId: v.id(TABLE.INVITATIONS) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<boolean, AuthErrors | NotFoundErrorObject> {
		const [actorId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		const row = await ctx.db.get(args.invitationId);
		if (!row) return [null, new NotFoundError("Invitation not found").toObject()];

		const [, permErr] = await assertCanManageInvitation(ctx, actorId, row);
		if (permErr) return [null, permErr];

		await ctx.db.patch(args.invitationId, {
			status: INVITATION_STATUS.REVOKED,
			revokedAt: Date.now(),
			revokedBy: actorId,
			...stampUpdated(actorId),
		});

		return [true, null];
	},
});

export const listForOrganization = query({
	args: { organizationId: v.id(TABLE.ORGANIZATIONS) },
	handler: async (ctx, args) => {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		const [, permErr] = await assertOrgOwnerOrAdmin(ctx, userId, args.organizationId);
		if (permErr) return [null, permErr];

		const rows = await ctx.db
			.query(TABLE.INVITATIONS)
			.withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
			.collect();

		return [rows, null];
	},
});

export const getByTokenPublic = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const row = await ctx.db
			.query(TABLE.INVITATIONS)
			.withIndex("by_token", (q) => q.eq("token", args.token))
			.first();
		if (!row) return null;
		return {
			email: row.email,
			organizationId: row.organizationId,
			role: row.role,
			status: row.status,
			expiresAt: row.expiresAt,
		};
	},
});

export const getByIdInternal = internalQuery({
	args: { invitationId: v.id(TABLE.INVITATIONS) },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.invitationId);
	},
});

export const expirePendingInvitations = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const rows = await ctx.db.query(TABLE.INVITATIONS).collect();
		for (const row of rows) {
			if (row.status !== INVITATION_STATUS.PENDING) continue;
			if (row.expiresAt >= now) continue;
			await ctx.db.patch(row._id, {
				status: INVITATION_STATUS.EXPIRED,
				...stampUpdated(AUDIT_SYSTEM_USER_ID),
			});
		}
	},
});
