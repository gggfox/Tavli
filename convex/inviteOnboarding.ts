/**
 * Admin cross-organization user onboarding.
 *
 * The platform admin cannot *create* people: there is no `@clerk/backend` usage
 * anywhere in `convex/` — Convex only verifies Clerk JWTs, every `userId` is an
 * opaque Clerk subject, and there is no email → subject lookup. So "add a user
 * to an org" means CREATE AN INVITATION; the person signs up with Clerk
 * themselves and accepts it. `admin.createUserRole` is unusable for a new
 * person because it needs a subject id nobody can know yet.
 *
 * Managed employee accounts (PIN, no Clerk identity — ADR 006) are deliberately
 * out of scope: they stay manager-created, one at a time, in the team tab.
 * Nothing here mints or stores a PIN. An employee *can* still be invited here —
 * that is a normal invitation with `role: "employee"` and restaurant ids, and
 * produces a real Clerk-backed user.
 *
 * Three entry points, all platform-admin only:
 *   - `createAdminInvitation` — one invite into any organization;
 *   - `generateInviteUploadUrl` + `inviteOnboardingActions.previewInviteCsv` —
 *     upload a CSV, get a per-row classification back, create nothing;
 *   - `commitBulkInvitations` — create invitations for the rows the admin
 *     confirmed, re-validating every one of them server-side.
 *
 * `invites.createInvitation` (the team tab's org-scoped path) is untouched by
 * design: it keeps its own permission ladder for owners and managers.
 */

import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, MutationCtx, QueryCtx } from "./_generated/server";
import { internalQuery, mutation } from "./_generated/server";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	RateLimitedError,
	RateLimitedErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { appendAuditEvent, stampUpdated } from "./_util/audit";
import { getCurrentUserId, requireAdminRole } from "./_util/auth";
import {
	AUDIT_EVENT,
	INVITATION_STATUS,
	INVITE_BULK_COMMIT_MAX_ROWS,
	RESTAURANT_MEMBER_ROLE,
	TABLE,
	USER_ROLES,
} from "./constants";
import { insertInvitationRow, normalizeEmail } from "./invites";
import type {
	InviteOverride,
	InviteRole,
	InviteRowFacts,
	InviteRowStatus,
	InviteRowVerdict,
} from "./inviteOnboardingHelpers";
import {
	classifyInviteRow,
	INVITE_OVERRIDE,
	INVITE_ROW_STATUS,
	inviteDedupeKey,
	inviteRowErrorCode,
	inviteRowErrorField,
	isInviteRowCommittable,
} from "./inviteOnboardingHelpers";
import { consumeInvitationBudget } from "./inviteRateLimit";

type AuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;
type DbReadCtx = { db: DatabaseReader };

/** Stable code when a commit chunk is larger than one transaction should carry. */
export const ERROR_INVITE_BULK_TOO_MANY_ROWS = "ERROR_INVITE_BULK_TOO_MANY_ROWS";

const INVITE_ROLE_VALIDATOR = v.union(
	v.literal(USER_ROLES.OWNER),
	v.literal(RESTAURANT_MEMBER_ROLE.MANAGER),
	v.literal(RESTAURANT_MEMBER_ROLE.EMPLOYEE)
);

// =============================================================================
// Resolution — turning what an admin typed into ids
// =============================================================================

/**
 * Names are matched case- and whitespace-insensitively. "Exact name" in the CSV
 * spec means "the whole name", not "byte-identical" — a trailing space in a
 * spreadsheet cell should not send an admin hunting for a typo.
 */
function canonicalizeName(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, " ");
}

interface OrganizationDirectory {
	byId: Map<string, Doc<"organizations">>;
	idsByName: Map<string, string[]>;
}

/**
 * The whole organization table, loaded once per request. This is the same scan
 * `organizations.getAllOrganizations` already does for the admin directory, and
 * doing it once beats resolving 500 CSV rows one lookup at a time.
 */
async function loadOrganizationDirectory(ctx: DbReadCtx): Promise<OrganizationDirectory> {
	const organizations = await ctx.db.query(TABLE.ORGANIZATIONS).collect();
	const byId = new Map<string, Doc<"organizations">>();
	const idsByName = new Map<string, string[]>();

	for (const organization of organizations) {
		const id = String(organization._id);
		byId.set(id, organization);
		const key = canonicalizeName(organization.name);
		idsByName.set(key, [...(idsByName.get(key) ?? []), id]);
	}

	return { byId, idsByName };
}

type OrganizationResolution = InviteRowFacts["organization"];

/** Accepts an organization id or an exact organization name. */
function resolveOrganizationToken(
	directory: OrganizationDirectory,
	token: string
): OrganizationResolution {
	const trimmed = token.trim();
	if (trimmed.length === 0) return { status: "not_found" };
	if (directory.byId.has(trimmed)) return { status: "found", id: trimmed };

	const matches = directory.idsByName.get(canonicalizeName(trimmed)) ?? [];
	if (matches.length === 1) return { status: "found", id: matches[0] };
	// Two organizations sharing a name is legal; the CSV then cannot say which,
	// so the row is an error rather than a coin flip.
	if (matches.length > 1) return { status: "ambiguous" };
	return { status: "not_found" };
}

/** Live (not soft-deleted) restaurants of one org, memoized per request. */
async function loadOrgRestaurants(
	ctx: DbReadCtx,
	organizationId: Id<"organizations">,
	cache: Map<string, Doc<"restaurants">[]>
): Promise<Doc<"restaurants">[]> {
	const key = String(organizationId);
	const cached = cache.get(key);
	if (cached) return cached;

	const rows = await ctx.db
		.query(TABLE.RESTAURANTS)
		.withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
		.collect();
	const live = rows.filter((row) => row.deletedAt === undefined);
	cache.set(key, live);
	return live;
}

/**
 * Resolve restaurant tokens (ids or exact names) against ONE organization.
 *
 * An id that resolves to a restaurant in a different org is reported separately
 * (`foreignTokens`) from one that resolves to nothing (`unknownTokens`) — the
 * first is a cross-tenant mistake worth naming, the second is a typo. Name
 * tokens are only ever searched inside the target org, so a name belonging to
 * another tenant simply reads as unknown.
 */
async function resolveRestaurantTokens(
	ctx: QueryCtx,
	args: {
		tokens: string[];
		organizationId: Id<"organizations">;
		orgRestaurants: Doc<"restaurants">[];
	}
): Promise<InviteRowFacts["restaurants"]> {
	const resolvedIds: string[] = [];
	const unknownTokens: string[] = [];
	const ambiguousTokens: string[] = [];
	const foreignTokens: string[] = [];

	const byName = new Map<string, Doc<"restaurants">[]>();
	for (const restaurant of args.orgRestaurants) {
		const key = canonicalizeName(restaurant.name);
		byName.set(key, [...(byName.get(key) ?? []), restaurant]);
	}

	for (const token of args.tokens) {
		const asId = ctx.db.normalizeId(TABLE.RESTAURANTS, token);
		if (asId) {
			const restaurant = await ctx.db.get(asId);
			if (!restaurant || restaurant.deletedAt !== undefined) {
				unknownTokens.push(token);
			} else if (restaurant.organizationId !== args.organizationId) {
				foreignTokens.push(token);
			} else {
				resolvedIds.push(String(asId));
			}
			continue;
		}

		const matches = byName.get(canonicalizeName(token)) ?? [];
		if (matches.length === 1) resolvedIds.push(String(matches[0]._id));
		else if (matches.length > 1) ambiguousTokens.push(token);
		else unknownTokens.push(token);
	}

	return { resolvedIds, unknownTokens, ambiguousTokens, foreignTokens };
}

/**
 * Every organization this email already holds a role in.
 *
 * `acceptInvitation` normalizes before writing `userRoles.email`, so the
 * normalized probe finds everything the invitation flow has ever produced. The
 * raw-trimmed probe is a cheap second index read that also catches rows written
 * by the dev-only role switcher (`admin.devSetOwnRoles`), which stores
 * `identity.email` verbatim. Missing a row here would mean missing a `cross_org`
 * warning, so the redundancy is deliberate.
 */
async function lookupExistingRoleOrganizations(
	ctx: DbReadCtx,
	args: { rawEmail: string; normalizedEmail: string }
): Promise<(string | undefined)[]> {
	const probes = new Set<string>([args.normalizedEmail]);
	const trimmed = args.rawEmail.trim();
	if (trimmed.length > 0 && trimmed !== args.normalizedEmail) probes.add(trimmed);

	const organizationIds: (string | undefined)[] = [];
	for (const probe of probes) {
		const rows = await ctx.db
			.query(TABLE.USER_ROLES)
			.withIndex("by_email", (q) => q.eq("email", probe))
			.collect();
		for (const row of rows) organizationIds.push(row.organizationId);
	}
	return organizationIds;
}

/** Pending, unexpired invitations for this email + organization. */
async function findPendingInvitations(
	ctx: DbReadCtx,
	args: { normalizedEmail: string; organizationId: Id<"organizations">; now: number }
): Promise<Doc<"invitations">[]> {
	const rows = await ctx.db
		.query(TABLE.INVITATIONS)
		.withIndex("by_email", (q) => q.eq("email", args.normalizedEmail))
		.collect();

	return rows.filter(
		(row) =>
			row.organizationId === args.organizationId &&
			row.status === INVITATION_STATUS.PENDING &&
			row.expiresAt > args.now
	);
}

// =============================================================================
// Classification
// =============================================================================

interface ClassifyArgs {
	rawEmail: string;
	role: string;
	organization: OrganizationResolution;
	restaurants: InviteRowFacts["restaurants"];
	now: number;
	/** Dedupe keys already claimed by earlier rows of the same batch. */
	seen?: Set<string>;
}

/**
 * Complete the database-dependent facts and hand them to the pure classifier.
 * Shared by the CSV preview, the single-invite mutation and the bulk commit, so
 * all three reach identical verdicts from identical evidence.
 */
async function classifyWithDatabase(ctx: DbReadCtx, args: ClassifyArgs): Promise<InviteRowVerdict> {
	const normalizedEmail = normalizeEmail(args.rawEmail);

	// Only worth the index reads once we know which organization we are asking
	// about; an unresolved org row is an error regardless of who the person is.
	if (args.organization.status !== "found") {
		return classifyInviteRow({
			email: args.rawEmail,
			role: args.role,
			organization: args.organization,
			restaurants: args.restaurants,
			existingRoleOrganizationIds: [],
			pendingInvitationInTargetOrg: false,
		});
	}

	const organizationId = args.organization.id as Id<"organizations">;

	const existingRoleOrganizationIds = await lookupExistingRoleOrganizations(ctx, {
		rawEmail: args.rawEmail,
		normalizedEmail,
	});
	const pending = await findPendingInvitations(ctx, {
		normalizedEmail,
		organizationId,
		now: args.now,
	});

	return classifyInviteRow({
		email: args.rawEmail,
		role: args.role,
		organization: args.organization,
		restaurants: args.restaurants,
		existingRoleOrganizationIds,
		pendingInvitationInTargetOrg: pending.length > 0,
		duplicateEarlierInFile:
			args.seen?.has(inviteDedupeKey(normalizedEmail, String(organizationId))) === true,
	});
}

/**
 * Classify an invitation whose organization and restaurants are already ids —
 * the single-invite form and the bulk commit both arrive in this shape. Ids
 * that no longer resolve degrade to the same verdicts a bad CSV token would
 * produce, which is what makes commit-time re-validation meaningful.
 */
async function classifyResolvedInvite(
	ctx: QueryCtx,
	args: {
		email: string;
		role: string;
		organizationId: Id<"organizations">;
		restaurantIds: Id<"restaurants">[];
		now: number;
		seen?: Set<string>;
	}
): Promise<InviteRowVerdict> {
	const organization = await ctx.db.get(args.organizationId);
	const resolution: OrganizationResolution = organization
		? { status: "found", id: String(organization._id) }
		: { status: "not_found" };

	const restaurants: InviteRowFacts["restaurants"] = {
		resolvedIds: [],
		unknownTokens: [],
		ambiguousTokens: [],
		foreignTokens: [],
	};

	for (const restaurantId of args.restaurantIds) {
		const restaurant = await ctx.db.get(restaurantId);
		if (!restaurant || restaurant.deletedAt !== undefined) {
			restaurants.unknownTokens.push(String(restaurantId));
		} else if (restaurant.organizationId !== args.organizationId) {
			restaurants.foreignTokens.push(String(restaurantId));
		} else {
			restaurants.resolvedIds.push(String(restaurantId));
		}
	}

	return classifyWithDatabase(ctx, {
		rawEmail: args.email,
		role: args.role,
		organization: resolution,
		restaurants,
		now: args.now,
		seen: args.seen,
	});
}

// =============================================================================
// Upload
// =============================================================================

/**
 * Hand back a Convex storage upload URL for the invite CSV. Admin-only, and
 * deliberately arg-less: the file is not scoped to a restaurant or an org — a
 * single upload may span every tenant on the platform.
 */
export const generateInviteUploadUrl = mutation({
	args: {},
	handler: async function (ctx): AsyncReturn<string, AuthErrors> {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		const [, roleErr] = await requireAdminRole(ctx, userId);
		if (roleErr) return [null, roleErr];

		const url = await ctx.storage.generateUploadUrl();
		return [url, null];
	},
});

/**
 * Admin gate for the "use node"-free preview action, which has no `ctx.db`.
 * Called BEFORE the uploaded blob is read so a non-admin never gets so much as
 * a parse error out of somebody else's file.
 */
export const assertInviteOnboardingAdmin = internalQuery({
	args: { userId: v.string() },
	returns: v.boolean(),
	handler: async (ctx, args): Promise<boolean> => {
		const [, err] = await requireAdminRole(ctx, args.userId);
		return err === null;
	},
});

// =============================================================================
// Preview
// =============================================================================

const RAW_CSV_ROW_VALIDATOR = v.object({
	rowNumber: v.number(),
	email: v.string(),
	role: v.string(),
	organization: v.string(),
	restaurants: v.array(v.string()),
	firstName: v.optional(v.string()),
	paternalLastname: v.optional(v.string()),
	maternalLastname: v.optional(v.string()),
});

/** One classified row of the preview table. Ids are plain strings for transport. */
export interface InvitePreviewRow {
	/** 1-based position among the CSV's data rows. */
	rowNumber: number;
	email: string;
	role: InviteRole | null;
	organizationId: string | null;
	organizationName: string | null;
	restaurantIds: string[];
	restaurantNames: string[];
	firstName?: string;
	paternalLastname?: string;
	maternalLastname?: string;
	status: InviteRowStatus;
	blocked: boolean;
	override: InviteOverride | null;
	/** Stable code for a blocking verdict; `null` when the row is sendable. */
	errorCode: string | null;
}

export interface InvitePreviewCounts {
	total: number;
	ok: number;
	alreadyMember: number;
	crossOrg: number;
	duplicatePending: number;
	duplicateInFile: number;
	invalid: number;
}

/**
 * Declared explicitly rather than inferred: the preview action calls this
 * query, so letting TypeScript infer the shape makes the two modules
 * mutually recursive (TS7023).
 */
export type InvitePreviewResult =
	| [{ rows: InvitePreviewRow[]; counts: InvitePreviewCounts }, null]
	| [null, NotAuthorizedErrorObject];

/**
 * Classify parsed CSV rows without creating anything.
 *
 * Internal because it is reached through `inviteOnboardingActions.previewInviteCsv`
 * (an action, which cannot touch `ctx.db`) — the same action/internal split
 * `menuImport.ts` uses. Authorization is re-asserted here rather than trusted
 * from the action.
 */
export const previewInviteRowsInternal = internalQuery({
	args: { userId: v.string(), rows: v.array(RAW_CSV_ROW_VALIDATOR) },
	handler: async (ctx, args): Promise<InvitePreviewResult> => {
		const [, roleErr] = await requireAdminRole(ctx, args.userId);
		if (roleErr) return [null, roleErr];

		const now = Date.now();
		const directory = await loadOrganizationDirectory(ctx);
		const restaurantCache = new Map<string, Doc<"restaurants">[]>();
		const seen = new Set<string>();

		const rows: InvitePreviewRow[] = [];
		for (const row of args.rows) {
			const organization = resolveOrganizationToken(directory, row.organization);

			const restaurants =
				organization.status === "found"
					? await resolveRestaurantTokens(ctx, {
							tokens: row.restaurants,
							organizationId: organization.id as Id<"organizations">,
							orgRestaurants: await loadOrgRestaurants(
								ctx,
								organization.id as Id<"organizations">,
								restaurantCache
							),
						})
					: {
							resolvedIds: [],
							unknownTokens: row.restaurants,
							ambiguousTokens: [],
							foreignTokens: [],
						};

			const verdict = await classifyWithDatabase(ctx, {
				rawEmail: row.email,
				role: row.role,
				organization,
				restaurants,
				now,
				seen,
			});

			if (verdict.organizationId) {
				seen.add(inviteDedupeKey(verdict.normalizedEmail, verdict.organizationId));
			}

			const organizationDoc = verdict.organizationId
				? (directory.byId.get(verdict.organizationId) ?? null)
				: null;
			const orgRestaurants = verdict.organizationId
				? (restaurantCache.get(verdict.organizationId) ?? [])
				: [];

			rows.push({
				rowNumber: row.rowNumber,
				email: verdict.normalizedEmail,
				role: verdict.role,
				organizationId: verdict.organizationId,
				organizationName: organizationDoc?.name ?? null,
				restaurantIds: verdict.restaurantIds,
				restaurantNames: verdict.restaurantIds.map(
					(id) => orgRestaurants.find((r) => String(r._id) === id)?.name ?? id
				),
				firstName: row.firstName,
				paternalLastname: row.paternalLastname,
				maternalLastname: row.maternalLastname,
				status: verdict.status,
				blocked: verdict.blocked,
				override: verdict.override,
				errorCode: verdict.blocked ? inviteRowErrorCode(verdict.status) : null,
			});
		}

		const counts = {
			total: rows.length,
			ok: rows.filter((r) => r.status === INVITE_ROW_STATUS.OK).length,
			alreadyMember: rows.filter((r) => r.status === INVITE_ROW_STATUS.ALREADY_MEMBER).length,
			crossOrg: rows.filter((r) => r.status === INVITE_ROW_STATUS.CROSS_ORG).length,
			duplicatePending: rows.filter((r) => r.status === INVITE_ROW_STATUS.DUPLICATE_PENDING).length,
			duplicateInFile: rows.filter((r) => r.status === INVITE_ROW_STATUS.DUPLICATE_IN_FILE).length,
			invalid: rows.filter((r) => r.status.startsWith("invalid_")).length,
		};

		return [{ rows, counts }, null];
	},
});

// =============================================================================
// Single invite
// =============================================================================

function classificationError(verdict: InviteRowVerdict): UserInputValidationErrorObject {
	return new UserInputValidationError({
		fields: [
			{
				field: inviteRowErrorField(verdict.status),
				message: inviteRowErrorCode(verdict.status),
			},
		],
	}).toObject();
}

/**
 * Revoke the pending invitations a "replace" acknowledgement supersedes, so at
 * most one pending invitation exists per (email, organization). Chosen over
 * simply allowing a second row: two live tokens for the same person is a
 * confusing inbox and a wider revocation surface.
 */
async function revokeSupersededInvitations(
	ctx: MutationCtx,
	args: {
		actorId: string;
		normalizedEmail: string;
		organizationId: Id<"organizations">;
		now: number;
	}
): Promise<number> {
	const pending = await findPendingInvitations(ctx, {
		normalizedEmail: args.normalizedEmail,
		organizationId: args.organizationId,
		now: args.now,
	});

	for (const invitation of pending) {
		await ctx.db.patch(invitation._id, {
			status: INVITATION_STATUS.REVOKED,
			revokedAt: args.now,
			revokedBy: args.actorId,
			...stampUpdated(args.actorId),
		});
		await appendAuditEvent(ctx, {
			aggregateType: TABLE.INVITATIONS,
			aggregateId: invitation._id,
			eventType: AUDIT_EVENT.INVITATION_REVOKED,
			restaurantId: null,
			payload: {
				email: invitation.email,
				role: invitation.role,
				restaurantIds: invitation.restaurantIds,
				reason: "superseded",
			},
			userId: args.actorId,
		});
	}

	return pending.length;
}

/**
 * Invite one person into ANY organization.
 *
 * A sibling of `invites.createInvitation` rather than an extension of it. That
 * mutation is the org-scoped path the team tab uses, and its `assertCanCreateInvitation`
 * ladder deliberately admits org owners and restaurant managers. Bolting the
 * cross-org gate onto it would either start refusing invites those callers make
 * today (breaking the team tab) or require a "skip the checks" flag, which is
 * worse than a separate admin-only entry point. Here the gate is unconditional:
 * `requireAdminRole`, an explicit `organizationId` that is never derived from
 * the caller's own tenancy, and a refusal to proceed on a blocking verdict
 * without the matching acknowledgement.
 */
export const createAdminInvitation = mutation({
	args: {
		organizationId: v.id(TABLE.ORGANIZATIONS),
		email: v.string(),
		role: INVITE_ROLE_VALIDATOR,
		restaurantIds: v.array(v.id(TABLE.RESTAURANTS)),
		expiresInMs: v.optional(v.number()),
		firstName: v.optional(v.string()),
		paternalLastname: v.optional(v.string()),
		maternalLastname: v.optional(v.string()),
		/** Required to proceed when the invitee already belongs to another org. */
		acknowledgeOrgMove: v.optional(v.boolean()),
		/** Required to proceed when a pending invitation already exists; revokes it. */
		replaceExistingPending: v.optional(v.boolean()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<
		{
			invitationId: Id<"invitations">;
			status: string;
			replacedPendingCount: number;
		},
		AuthErrors | UserInputValidationErrorObject | RateLimitedErrorObject
	> {
		const [actorId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		const [, roleErr] = await requireAdminRole(ctx, actorId);
		if (roleErr) return [null, roleErr];

		const now = Date.now();
		const verdict = await classifyResolvedInvite(ctx, {
			email: args.email,
			role: args.role,
			organizationId: args.organizationId,
			restaurantIds: args.restaurantIds,
			now,
		});

		const committable = isInviteRowCommittable(verdict, {
			[INVITE_OVERRIDE.ACKNOWLEDGE_ORG_MOVE]: args.acknowledgeOrgMove === true,
			[INVITE_OVERRIDE.REPLACE_EXISTING_PENDING]: args.replaceExistingPending === true,
		});
		if (!committable) return [null, classificationError(verdict)];

		// `committable` proves the verdict is non-blocking, which proves role and
		// organizationId parsed — narrow for the type checker.
		if (verdict.role === null || verdict.organizationId === null) {
			return [null, classificationError(verdict)];
		}

		const limited = await consumeInvitationBudget(ctx, {
			actorId,
			normalizedEmail: verdict.normalizedEmail,
		});
		if (limited) return [null, new RateLimitedError(limited).toObject()];

		const replacedPendingCount =
			verdict.status === INVITE_ROW_STATUS.DUPLICATE_PENDING
				? await revokeSupersededInvitations(ctx, {
						actorId,
						normalizedEmail: verdict.normalizedEmail,
						organizationId: args.organizationId,
						now,
					})
				: 0;

		const invitationId = await insertInvitationRow(ctx, {
			actorId,
			organizationId: args.organizationId,
			email: verdict.normalizedEmail,
			role: verdict.role as InviteRole,
			restaurantIds: verdict.restaurantIds as Id<"restaurants">[],
			expiresInMs: args.expiresInMs,
			firstName: args.firstName,
			paternalLastname: args.paternalLastname,
			maternalLastname: args.maternalLastname,
		});

		return [{ invitationId, status: verdict.status, replacedPendingCount }, null];
	},
});

// =============================================================================
// Bulk commit
// =============================================================================

const COMMIT_ROW_VALIDATOR = v.object({
	rowNumber: v.number(),
	email: v.string(),
	role: INVITE_ROLE_VALIDATOR,
	organizationId: v.id(TABLE.ORGANIZATIONS),
	restaurantIds: v.array(v.id(TABLE.RESTAURANTS)),
	firstName: v.optional(v.string()),
	paternalLastname: v.optional(v.string()),
	maternalLastname: v.optional(v.string()),
	acknowledgeOrgMove: v.optional(v.boolean()),
	replaceExistingPending: v.optional(v.boolean()),
});

/** What happened to one confirmed row. */
export const INVITE_COMMIT_OUTCOME = {
	/** An invitation row was written and its email scheduled. */
	CREATED: "created",
	/** Blocked by a verdict the admin could have acknowledged but did not. */
	SKIPPED: "skipped",
	/** Blocked by something no acknowledgement can clear, or rate-limited. */
	FAILED: "failed",
} as const;

export type InviteCommitOutcome =
	(typeof INVITE_COMMIT_OUTCOME)[keyof typeof INVITE_COMMIT_OUTCOME];

/**
 * Create invitations for the rows an admin confirmed in the preview.
 *
 * Every row is RE-CLASSIFIED here against live data — the client's preview
 * verdict is never trusted. An organization deleted, a restaurant moved to
 * another tenant, or a competing invitation created between preview and confirm
 * all turn into a per-row rejection instead of a bad insert.
 *
 * Chunked at {@link INVITE_BULK_COMMIT_MAX_ROWS}: the preview allows 500 rows,
 * and the client walks them in chunks. Each row costs up to three documents plus
 * a scheduled email, so a bounded chunk keeps the transaction small and makes a
 * mid-run failure cost one chunk rather than the whole upload. Pass the same
 * `bulkImportId` across a run's chunks to tie their audit events together.
 */
export const commitBulkInvitations = mutation({
	args: {
		rows: v.array(COMMIT_ROW_VALIDATOR),
		bulkImportId: v.optional(v.string()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<
		{
			bulkImportId: string;
			results: {
				rowNumber: number;
				email: string;
				outcome: InviteCommitOutcome;
				status: string;
				code: string | null;
				invitationId: Id<"invitations"> | null;
			}[];
			counts: { requested: number; created: number; skipped: number; failed: number };
		},
		AuthErrors | UserInputValidationErrorObject
	> {
		const [actorId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		const [, roleErr] = await requireAdminRole(ctx, actorId);
		if (roleErr) return [null, roleErr];

		if (args.rows.length > INVITE_BULK_COMMIT_MAX_ROWS) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "rows", message: ERROR_INVITE_BULK_TOO_MANY_ROWS }],
				}).toObject(),
			];
		}

		const bulkImportId = args.bulkImportId ?? crypto.randomUUID();
		const now = Date.now();
		// Only rows that actually got created claim a dedupe key, so a skipped
		// row never poisons a later legitimate one.
		const created = new Set<string>();
		const results = [];

		for (const row of args.rows) {
			const verdict = await classifyResolvedInvite(ctx, {
				email: row.email,
				role: row.role,
				organizationId: row.organizationId,
				restaurantIds: row.restaurantIds,
				now,
				seen: created,
			});

			const committable = isInviteRowCommittable(verdict, {
				[INVITE_OVERRIDE.ACKNOWLEDGE_ORG_MOVE]: row.acknowledgeOrgMove === true,
				[INVITE_OVERRIDE.REPLACE_EXISTING_PENDING]: row.replaceExistingPending === true,
			});

			if (!committable || verdict.role === null || verdict.organizationId === null) {
				results.push({
					rowNumber: row.rowNumber,
					email: verdict.normalizedEmail,
					// An acknowledgement exists for this verdict but was not given →
					// the admin can retry; nothing can clear the others.
					outcome:
						verdict.override !== null
							? INVITE_COMMIT_OUTCOME.SKIPPED
							: INVITE_COMMIT_OUTCOME.FAILED,
					status: verdict.status,
					code: inviteRowErrorCode(verdict.status),
					invitationId: null,
				});
				continue;
			}

			const limited = await consumeInvitationBudget(ctx, {
				actorId,
				normalizedEmail: verdict.normalizedEmail,
			});
			if (limited) {
				results.push({
					rowNumber: row.rowNumber,
					email: verdict.normalizedEmail,
					outcome: INVITE_COMMIT_OUTCOME.FAILED,
					status: verdict.status,
					code: limited,
					invitationId: null,
				});
				continue;
			}

			if (verdict.status === INVITE_ROW_STATUS.DUPLICATE_PENDING) {
				await revokeSupersededInvitations(ctx, {
					actorId,
					normalizedEmail: verdict.normalizedEmail,
					organizationId: row.organizationId,
					now,
				});
			}

			const invitationId = await insertInvitationRow(ctx, {
				actorId,
				organizationId: row.organizationId,
				email: verdict.normalizedEmail,
				role: verdict.role as InviteRole,
				restaurantIds: verdict.restaurantIds as Id<"restaurants">[],
				firstName: row.firstName,
				paternalLastname: row.paternalLastname,
				maternalLastname: row.maternalLastname,
			});

			created.add(inviteDedupeKey(verdict.normalizedEmail, verdict.organizationId));
			results.push({
				rowNumber: row.rowNumber,
				email: verdict.normalizedEmail,
				outcome: INVITE_COMMIT_OUTCOME.CREATED,
				status: verdict.status,
				code: null,
				invitationId,
			});
		}

		const counts = {
			requested: args.rows.length,
			created: results.filter((r) => r.outcome === INVITE_COMMIT_OUTCOME.CREATED).length,
			skipped: results.filter((r) => r.outcome === INVITE_COMMIT_OUTCOME.SKIPPED).length,
			failed: results.filter((r) => r.outcome === INVITE_COMMIT_OUTCOME.FAILED).length,
		};

		// Counts and target organizations only. Each created invitation already
		// records its own recipient via `invitations.created`, so repeating the
		// address list here would duplicate PII for no added traceability.
		await appendAuditEvent(ctx, {
			aggregateType: TABLE.INVITATIONS,
			aggregateId: `bulk:${bulkImportId}`,
			eventType: AUDIT_EVENT.INVITATION_BULK_IMPORTED,
			restaurantId: null,
			payload: {
				bulkImportId,
				...counts,
				organizationIds: [...new Set(args.rows.map((row) => String(row.organizationId)))],
			},
			userId: actorId,
		});

		return [{ bulkImportId, results, counts }, null];
	},
});
