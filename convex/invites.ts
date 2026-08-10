import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import {
	NotAuthenticatedError,
	NotAuthenticatedErrorObject,
	NotAuthorizedError,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	RateLimitedError,
	RateLimitedErrorObject,
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
	AUDIT_EVENT,
	AUDIT_SYSTEM_USER_ID,
	INVITATION_STATUS,
	RESTAURANT_MEMBER_ROLE,
	TABLE,
	USER_ROLES,
} from "./constants";
import { buildInviterDisplayName } from "./emails/contextHelpers";
import { resolveInviteLocale } from "./emails/locale";
import type { InviteRole } from "./inviteOnboardingHelpers";
import { consumeInvitationBudget } from "./inviteRateLimit";

type AuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

/** Default invitation lifetime: a week is long enough to survive a holiday. */
export const INVITATION_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Write one invitation row, audit it, and queue its email.
 *
 * Shared by the org-scoped `createInvitation` (team tab) and the admin
 * onboarding paths in `convex/inviteOnboarding.ts` so the three of them cannot
 * drift on token generation, TTL, audit shape, or email dispatch. Callers own
 * authorization, classification and rate limiting BEFORE calling this — this
 * function trusts what it is handed.
 */
export async function insertInvitationRow(
	ctx: MutationCtx,
	args: {
		actorId: string;
		organizationId: Id<"organizations">;
		/** Must already be normalized by the caller. */
		email: string;
		role: InviteRole;
		restaurantIds: Id<"restaurants">[];
		expiresInMs?: number;
		firstName?: string;
		paternalLastname?: string;
		maternalLastname?: string;
	}
): Promise<Id<"invitations">> {
	const now = Date.now();
	const ttl = args.expiresInMs ?? INVITATION_DEFAULT_TTL_MS;

	const id = await ctx.db.insert(TABLE.INVITATIONS, {
		token: crypto.randomUUID(),
		email: args.email,
		organizationId: args.organizationId,
		role: args.role,
		restaurantIds: args.restaurantIds,
		invitedBy: args.actorId,
		status: INVITATION_STATUS.PENDING,
		expiresAt: now + ttl,
		...(args.firstName && { firstName: args.firstName.trim() }),
		...(args.paternalLastname && { paternalLastname: args.paternalLastname.trim() }),
		...(args.maternalLastname && { maternalLastname: args.maternalLastname.trim() }),
		createdAt: now,
		updatedAt: now,
		updatedBy: args.actorId,
	});

	await appendAuditEvent(ctx, {
		aggregateType: TABLE.INVITATIONS,
		aggregateId: id,
		eventType: AUDIT_EVENT.INVITATION_CREATED,
		// Invitations can span several restaurants; the full list lives in the
		// payload rather than the single indexed column.
		restaurantId: null,
		payload: { email: args.email, role: args.role, restaurantIds: args.restaurantIds },
		userId: args.actorId,
	});

	await ctx.scheduler.runAfter(0, internal.inviteActions.sendInviteEmail, { invitationId: id });

	return id;
}

function maskInviteEmail(email: string): string {
	const at = email.indexOf("@");
	if (at <= 0) return "***";
	const local = email.slice(0, at);
	const domain = email.slice(at);
	if (local.length === 0) return `***${domain}`;
	return `${local[0]}***${domain}`;
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
		role:
			| typeof USER_ROLES.OWNER
			| typeof RESTAURANT_MEMBER_ROLE.MANAGER
			| typeof RESTAURANT_MEMBER_ROLE.EMPLOYEE;
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
		firstName: v.optional(v.string()),
		paternalLastname: v.optional(v.string()),
		maternalLastname: v.optional(v.string()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<
		Id<"invitations">,
		AuthErrors | UserInputValidationErrorObject | RateLimitedErrorObject
	> {
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

		const email = normalizeEmail(args.email);

		// Charged after authorization so an unauthorized caller cannot burn a
		// legitimate inviter's budget, and before the insert so a rejected hit
		// never schedules an email.
		const limited = await consumeInvitationBudget(ctx, { actorId, normalizedEmail: email });
		if (limited) return [null, new RateLimitedError(limited).toObject()];

		const id = await insertInvitationRow(ctx, {
			actorId,
			organizationId: args.organizationId,
			email,
			role: args.role,
			restaurantIds: args.restaurantIds,
			expiresInMs: args.expiresInMs,
			firstName: args.firstName,
			paternalLastname: args.paternalLastname,
			maternalLastname: args.maternalLastname,
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
		const idRecord = identity as unknown as {
			email?: string;
			emailAddress?: string;
			emailVerified?: boolean;
			email_verified?: boolean;
		};
		const emailVerified = idRecord.emailVerified ?? idRecord.email_verified;
		if (emailVerified !== true) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "email", message: "ERROR_EMAIL_NOT_VERIFIED" }],
				}).toObject(),
			];
		}
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
					fields: [
						{ field: "email", message: "Your account must have an email to accept invites" },
					],
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

		const inviteNameFields = {
			...(invitation.firstName && { firstName: invitation.firstName }),
			...(invitation.paternalLastname && { paternalLastname: invitation.paternalLastname }),
			...(invitation.maternalLastname && { maternalLastname: invitation.maternalLastname }),
		};

		if (invitation.role === USER_ROLES.OWNER) {
			const existing = await fetchUserRoleRecord(ctx, userId);
			const roles = new Set(existing?.roles ?? []);
			roles.add(USER_ROLES.OWNER);
			if (existing) {
				await ctx.db.patch(existing._id, {
					roles: [...roles],
					organizationId: invitation.organizationId,
					email: normalizeEmail(email),
					...inviteNameFields,
					updatedAt: now,
					updatedBy: userId,
				});
			} else {
				await ctx.db.insert(TABLE.USER_ROLES, {
					userId,
					email: normalizeEmail(email),
					roles: [...roles],
					organizationId: invitation.organizationId,
					...inviteNameFields,
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
				memberRole === RESTAURANT_MEMBER_ROLE.MANAGER ? USER_ROLES.MANAGER : USER_ROLES.EMPLOYEE;
			const roles = new Set(ur?.roles ?? []);
			roles.add(sidebarRole);
			if (ur) {
				await ctx.db.patch(ur._id, {
					roles: [...roles],
					organizationId: invitation.organizationId,
					email: normalizeEmail(email),
					...inviteNameFields,
					updatedAt: now,
					updatedBy: userId,
				});
			} else {
				await ctx.db.insert(TABLE.USER_ROLES, {
					userId,
					email: normalizeEmail(email),
					roles: [...roles],
					organizationId: invitation.organizationId,
					...inviteNameFields,
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
			eventType: AUDIT_EVENT.INVITATION_ACCEPTED,
			restaurantId: null,
			payload: { userId, restaurantIds: invitation.restaurantIds },
			userId,
		});

		return [{ ok: true }, null];
	},
});

export const revokeInvitation = mutation({
	args: { invitationId: v.id(TABLE.INVITATIONS) },
	handler: async function (ctx, args): AsyncReturn<boolean, AuthErrors | NotFoundErrorObject> {
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

		// Revocation emitted nothing until now, leaving a gap in the invitation
		// lifecycle: created and accepted were auditable, killing an invite was not.
		await appendAuditEvent(ctx, {
			aggregateType: TABLE.INVITATIONS,
			aggregateId: args.invitationId,
			eventType: AUDIT_EVENT.INVITATION_REVOKED,
			restaurantId: null,
			payload: { email: row.email, role: row.role, restaurantIds: row.restaurantIds },
			userId: actorId,
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
	args: {
		token: v.string(),
		now: v.optional(v.number()),
	},
	returns: v.union(
		v.object({
			email: v.string(),
			organizationId: v.id(TABLE.ORGANIZATIONS),
			role: v.union(
				v.literal(USER_ROLES.OWNER),
				v.literal(RESTAURANT_MEMBER_ROLE.MANAGER),
				v.literal(RESTAURANT_MEMBER_ROLE.EMPLOYEE)
			),
			status: v.literal(INVITATION_STATUS.PENDING),
			expiresAt: v.number(),
		}),
		v.null()
	),
	handler: async (ctx, args) => {
		const row = await ctx.db
			.query(TABLE.INVITATIONS)
			.withIndex("by_token", (q) => q.eq("token", args.token))
			.first();
		if (!row) return null;
		if (row.status !== INVITATION_STATUS.PENDING) return null;
		if (args.now !== undefined && row.expiresAt < args.now) return null;

		return {
			email: maskInviteEmail(row.email),
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

export const getInviteEmailContext = internalQuery({
	args: { invitationId: v.id(TABLE.INVITATIONS) },
	handler: async (ctx, args) => {
		const invitation = await ctx.db.get(args.invitationId);
		if (!invitation || invitation.status !== INVITATION_STATUS.PENDING) return null;

		const org = await ctx.db.get(invitation.organizationId);
		if (!org) return null;

		const inviter = await fetchUserRoleRecord(ctx, invitation.invitedBy);
		const inviterDisplayName = inviter ? buildInviterDisplayName(inviter) : null;

		const restaurantNames: string[] = [];
		let defaultLanguage: string | undefined;

		if (invitation.restaurantIds.length > 0) {
			const firstRestaurant = await ctx.db.get(invitation.restaurantIds[0]);
			defaultLanguage = firstRestaurant?.defaultLanguage;

			for (const restaurantId of invitation.restaurantIds) {
				const restaurant = await ctx.db.get(restaurantId);
				if (restaurant) restaurantNames.push(restaurant.name);
			}
		} else {
			const orgRestaurants = await ctx.db
				.query(TABLE.RESTAURANTS)
				.withIndex("by_organization", (q) => q.eq("organizationId", invitation.organizationId))
				.collect();

			const firstActive = orgRestaurants
				.filter((r) => r.isActive)
				.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))[0];

			defaultLanguage = firstActive?.defaultLanguage;
		}

		const locale = resolveInviteLocale(defaultLanguage);

		return {
			email: invitation.email,
			token: invitation.token,
			role: invitation.role as "owner" | "manager" | "employee",
			expiresAt: invitation.expiresAt,
			inviteeFirstName: invitation.firstName,
			organizationName: org.name,
			restaurantNames,
			inviterDisplayName,
			locale,
		};
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
