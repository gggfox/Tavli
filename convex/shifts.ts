/**
 * Shift CRUD + week reads.
 *
 * Authorization model:
 *   - Reads (`listForRestaurantWeek`) require manager-or-above for the restaurant.
 *   - Writes (`createShift`, `updateShift`, `cancelShift`) call
 *     `requireShiftTargetAuthority` so a restaurant manager can only target
 *     employees, while owners / admins can target any role. This mirrors
 *     `assertCanManageMembership` in `convex/restaurantMembers.ts`.
 *   - `publishWeek` requires manager-or-above and flips every SCHEDULED shift
 *     in `[weekStartMs, weekStartMs + 7d)` to PUBLISHED in one transaction.
 *
 * Template detachment:
 *   When a manager edits or cancels a shift that was materialized from a
 *   `shiftTemplates` row, the row is detached (`templateId: undefined`) so
 *   the override survives subsequent template edits and re-materialization
 *   passes. See `shiftTemplates.materializeAllTemplates` for the inverse.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalQuery,
	mutation,
	query,
	type MutationCtx,
	type QueryCtx,
} from "./_generated/server";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { appendAuditEvent, stampUpdated } from "./_util/audit";
import {
	getCurrentUserId,
	getRestaurantMembership,
	requireRestaurantManagerOrAbove,
	requireShiftTargetAuthority,
} from "./_util/auth";
import { SHIFT_STATUS, TABLE } from "./constants";

type AuthE = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
	return aStart < bEnd && bStart < aEnd;
}

/**
 * Active shifts (not CANCELLED) overlapping `[startsAt, endsAt)` for `memberId`,
 * optionally excluding a specific shift id (used by `updateShift` so the row
 * we are updating doesn't conflict with itself).
 */
async function memberHasOverlappingShift(
	ctx: { db: QueryCtx["db"] | MutationCtx["db"] },
	args: {
		memberId: Id<"restaurantMembers">;
		startsAt: number;
		endsAt: number;
		excludeShiftId?: Id<"shifts">;
	}
): Promise<boolean> {
	const existing = await ctx.db
		.query(TABLE.SHIFTS)
		.withIndex("by_member_time", (q) => q.eq("memberId", args.memberId))
		.collect();
	for (const s of existing) {
		if (s.status === SHIFT_STATUS.CANCELLED) continue;
		if (args.excludeShiftId && s._id === args.excludeShiftId) continue;
		if (rangesOverlap(s.startsAt, s.endsAt, args.startsAt, args.endsAt)) {
			return true;
		}
	}
	return false;
}

/**
 * Look up an active member row in this restaurant. Returns NOT_FOUND if the
 * row does not exist, belongs to a different restaurant, or is deactivated.
 */
async function loadActiveMember(
	ctx: { db: QueryCtx["db"] | MutationCtx["db"] },
	memberId: Id<"restaurantMembers">,
	restaurantId: Id<"restaurants">
): Promise<Doc<"restaurantMembers"> | null> {
	const member = await ctx.db.get(memberId);
	if (!member) return null;
	if (member.restaurantId !== restaurantId) return null;
	if (!member.isActive) return null;
	return member;
}

export const listForRestaurant = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		fromMs: v.number(),
		toMs: v.number(),
	},
	handler: async (ctx, args) => {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (aerr) return [null, aerr];

		const shifts = await ctx.db
			.query(TABLE.SHIFTS)
			.withIndex("by_restaurant_time", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		const filtered = shifts.filter(
			(s) => rangesOverlap(s.startsAt, s.endsAt, args.fromMs, args.toMs)
		);
		return [filtered, null];
	},
});

/**
 * Hydrated week read for the manager schedule grid: returns one row per shift
 * with the assigned member's `userId` and email (joined from `userRoles`),
 * sorted by start time. Cancelled shifts are excluded so the grid only shows
 * actionable rows.
 */
export const listForRestaurantWeek = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		weekStartMs: v.number(),
	},
	handler: async (ctx, args) => {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (aerr) return [null, aerr];

		const fromMs = args.weekStartMs;
		const toMs = args.weekStartMs + ONE_WEEK_MS;

		const shifts = await ctx.db
			.query(TABLE.SHIFTS)
			.withIndex("by_restaurant_time", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		const inWindow = shifts.filter(
			(s) =>
				s.status !== SHIFT_STATUS.CANCELLED &&
				rangesOverlap(s.startsAt, s.endsAt, fromMs, toMs)
		);

		const memberIds = Array.from(new Set(inWindow.map((s) => s.memberId)));
		const memberDocs = await Promise.all(memberIds.map((id) => ctx.db.get(id)));
		const memberById = new Map<string, Doc<"restaurantMembers">>();
		const userIdsForEmail = new Set<string>();
		for (const m of memberDocs) {
			if (!m) continue;
			memberById.set(m._id, m);
			if (m.userId) userIdsForEmail.add(m.userId);
		}

		const emailByUserId = new Map<string, string>();
		const userAvatarByUserId = new Map<string, { photoStorageId?: string; clerkImageUrl?: string }>();
		await Promise.all(
			Array.from(userIdsForEmail).map(async (uid) => {
				const rows = await ctx.db
					.query(TABLE.USER_ROLES)
					.withIndex("by_user", (q) => q.eq("userId", uid))
					.collect();
				for (const r of rows) {
					if (r.email && !emailByUserId.has(uid)) {
						emailByUserId.set(uid, r.email);
					}
					if (!userAvatarByUserId.has(uid)) {
						userAvatarByUserId.set(uid, {
							photoStorageId: r.photoStorageId as string | undefined,
							clerkImageUrl: r.clerkImageUrl,
						});
					}
				}
			})
		);

		const employeeAccountIds = new Set<string>();
		for (const m of memberDocs) {
			if (m?.employeeAccountId) employeeAccountIds.add(m.employeeAccountId);
		}
		const employeeAccountById = new Map<string, { firstName: string; paternalLastname: string; maternalLastname: string; photoStorageId?: string }>();
		await Promise.all(
			Array.from(employeeAccountIds).map(async (eaId) => {
				const ea = await ctx.db.get(eaId as Id<"employeeAccounts">);
				if (ea) {
					employeeAccountById.set(eaId, {
						firstName: ea.firstName,
						paternalLastname: ea.paternalLastname,
						maternalLastname: ea.maternalLastname,
						photoStorageId: ea.photoStorageId as string | undefined,
					});
				}
			})
		);

		const hydrated = await Promise.all(
			inWindow
				.slice()
				.sort((a, b) => a.startsAt - b.startsAt)
				.map(async (s) => {
					const m = memberById.get(s.memberId);
					let displayName = "";
					let photoUrl: string | null = null;

					if (m?.employeeAccountId) {
						const ea = employeeAccountById.get(m.employeeAccountId);
						if (ea) {
							displayName = [ea.firstName, ea.paternalLastname, ea.maternalLastname].filter(Boolean).join(" ");
							if (ea.photoStorageId) {
								photoUrl = await ctx.storage.getUrl(ea.photoStorageId as Id<"_storage">) ?? null;
							}
						}
					} else if (m?.userId) {
						const email = emailByUserId.get(m.userId);
						displayName = email ?? m.userId;
						const avatar = userAvatarByUserId.get(m.userId);
						if (avatar?.photoStorageId) {
							photoUrl = await ctx.storage.getUrl(avatar.photoStorageId as Id<"_storage">) ?? null;
						} else if (avatar?.clerkImageUrl) {
							photoUrl = avatar.clerkImageUrl;
						}
					}

					return {
						_id: s._id,
						memberId: s.memberId,
						restaurantId: s.restaurantId,
						startsAt: s.startsAt,
						endsAt: s.endsAt,
						shiftRole: s.shiftRole,
						status: s.status,
						notes: s.notes,
						templateId: s.templateId,
						publishedAt: s.publishedAt,
						member: m
							? {
									userId: m.userId ?? undefined,
									role: m.role,
									email: m.userId ? (emailByUserId.get(m.userId) ?? null) : null,
									displayName,
									photoUrl,
								}
							: null,
					};
				})
		);

		return [hydrated, null];
	},
});

/**
 * The caller's own upcoming PUBLISHED shifts at this restaurant. Used by
 * `/admin/schedule` when the viewer is not manager-or-above, so they only see
 * their own row. Drafts (SCHEDULED) and cancellations are intentionally
 * filtered out — employees only see committed shifts.
 */
export const listMyShifts = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		fromMs: v.number(),
		toMs: v.number(),
	},
	handler: async (ctx, args) => {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		const member = await getRestaurantMembership(ctx, userId, args.restaurantId);
		if (!member?.isActive) {
			return [[] as Doc<"shifts">[], null];
		}

		const shifts = await ctx.db
			.query(TABLE.SHIFTS)
			.withIndex("by_member_time", (q) => q.eq("memberId", member._id))
			.collect();
		const filtered = shifts
			.filter(
				(s) =>
					s.status === SHIFT_STATUS.PUBLISHED &&
					rangesOverlap(s.startsAt, s.endsAt, args.fromMs, args.toMs)
			)
			.sort((a, b) => a.startsAt - b.startsAt);
		return [filtered, null];
	},
});

export const createShift = mutation({
	args: {
		memberId: v.id(TABLE.RESTAURANT_MEMBERS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		startsAt: v.number(),
		endsAt: v.number(),
		shiftRole: v.optional(v.string()),
		notes: v.optional(v.string()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"shifts">, AuthE | NotFoundErrorObject | UserInputValidationErrorObject> {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		if (args.endsAt <= args.startsAt) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "endsAt", message: "Must be after startsAt" }],
				}).toObject(),
			];
		}

		const member = await loadActiveMember(ctx, args.memberId, args.restaurantId);
		if (!member) {
			return [null, new NotFoundError("Team member not found for restaurant").toObject()];
		}

		const [, permErr] = await requireShiftTargetAuthority(ctx, userId, {
			restaurantId: args.restaurantId,
			targetMember: member,
		});
		if (permErr) return [null, permErr];

		if (
			await memberHasOverlappingShift(ctx, {
				memberId: args.memberId,
				startsAt: args.startsAt,
				endsAt: args.endsAt,
			})
		) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "startsAt", message: "Overlaps another shift for this member" }],
				}).toObject(),
			];
		}

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.SHIFTS, {
			memberId: args.memberId,
			restaurantId: args.restaurantId,
			startsAt: args.startsAt,
			endsAt: args.endsAt,
			shiftRole: args.shiftRole,
			status: SHIFT_STATUS.SCHEDULED,
			notes: args.notes,
			createdBy: userId,
			createdAt: now,
			updatedAt: now,
			updatedBy: userId,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.SHIFTS,
			aggregateId: id,
			eventType: "shifts.created",
			payload: args,
			userId,
		});

		return [id, null];
	},
});

/**
 * Update a shift's time window, role, or notes. Detaches the shift from any
 * parent template so the override survives template edits or re-materialization.
 */
export const updateShift = mutation({
	args: {
		shiftId: v.id(TABLE.SHIFTS),
		startsAt: v.number(),
		endsAt: v.number(),
		shiftRole: v.optional(v.string()),
		notes: v.optional(v.string()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"shifts">, AuthE | NotFoundErrorObject | UserInputValidationErrorObject> {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		const shift = await ctx.db.get(args.shiftId);
		if (!shift) return [null, new NotFoundError("Shift not found").toObject()];

		const member = await loadActiveMember(ctx, shift.memberId, shift.restaurantId);
		if (!member) {
			return [null, new NotFoundError("Team member not found for restaurant").toObject()];
		}

		const [, permErr] = await requireShiftTargetAuthority(ctx, userId, {
			restaurantId: shift.restaurantId,
			targetMember: member,
		});
		if (permErr) return [null, permErr];

		if (args.endsAt <= args.startsAt) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "endsAt", message: "Must be after startsAt" }],
				}).toObject(),
			];
		}

		if (
			await memberHasOverlappingShift(ctx, {
				memberId: shift.memberId,
				startsAt: args.startsAt,
				endsAt: args.endsAt,
				excludeShiftId: shift._id,
			})
		) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "startsAt", message: "Overlaps another shift for this member" }],
				}).toObject(),
			];
		}

		const wasLinked = shift.templateId != null;

		await ctx.db.patch(args.shiftId, {
			startsAt: args.startsAt,
			endsAt: args.endsAt,
			shiftRole: args.shiftRole,
			notes: args.notes,
			templateId: undefined,
			...stampUpdated(userId),
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.SHIFTS,
			aggregateId: args.shiftId,
			eventType: "shifts.updated",
			payload: { ...args, detachedFromTemplate: wasLinked },
			userId,
		});

		if (wasLinked) {
			await appendAuditEvent(ctx, {
				aggregateType: TABLE.SHIFTS,
				aggregateId: args.shiftId,
				eventType: "shifts.detached_from_template",
				payload: { previousTemplateId: shift.templateId },
				userId,
			});
		}

		return [args.shiftId, null];
	},
});

export const cancelShift = mutation({
	args: { shiftId: v.id(TABLE.SHIFTS) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"shifts">, AuthE | NotFoundErrorObject> {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		const shift = await ctx.db.get(args.shiftId);
		if (!shift) return [null, new NotFoundError("Shift not found").toObject()];

		const member = await loadActiveMember(ctx, shift.memberId, shift.restaurantId);
		if (!member) {
			return [null, new NotFoundError("Team member not found for restaurant").toObject()];
		}

		const [, permErr] = await requireShiftTargetAuthority(ctx, userId, {
			restaurantId: shift.restaurantId,
			targetMember: member,
		});
		if (permErr) return [null, permErr];

		const wasLinked = shift.templateId != null;

		await ctx.db.patch(args.shiftId, {
			status: SHIFT_STATUS.CANCELLED,
			templateId: undefined,
			...stampUpdated(userId),
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.SHIFTS,
			aggregateId: args.shiftId,
			eventType: "shifts.cancelled",
			payload: { previousTemplateId: shift.templateId },
			userId,
		});

		if (wasLinked) {
			await appendAuditEvent(ctx, {
				aggregateType: TABLE.SHIFTS,
				aggregateId: args.shiftId,
				eventType: "shifts.detached_from_template",
				payload: { previousTemplateId: shift.templateId, viaCancellation: true },
				userId,
			});
		}

		return [args.shiftId, null];
	},
});

/**
 * Flip every SCHEDULED shift in `[weekStartMs, weekStartMs + 7d)` to PUBLISHED.
 * Returns the number of shifts published. Idempotent — re-running on the same
 * window after publish is a no-op.
 */
export const publishWeek = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		weekStartMs: v.number(),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<{ publishedCount: number }, AuthE | NotFoundErrorObject> {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (aerr) return [null, aerr];

		const weekEndMs = args.weekStartMs + ONE_WEEK_MS;
		const shifts = await ctx.db
			.query(TABLE.SHIFTS)
			.withIndex("by_restaurant_status_time", (q) =>
				q
					.eq("restaurantId", args.restaurantId)
					.eq("status", SHIFT_STATUS.SCHEDULED)
					.gte("startsAt", args.weekStartMs)
					.lt("startsAt", weekEndMs)
			)
			.collect();

		const now = Date.now();
		for (const s of shifts) {
			await ctx.db.patch(s._id, {
				status: SHIFT_STATUS.PUBLISHED,
				publishedAt: now,
				...stampUpdated(userId),
			});
		}

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.SHIFTS,
			aggregateId: args.restaurantId,
			eventType: "shifts.published_week",
			payload: {
				restaurantId: args.restaurantId,
				weekStartMs: args.weekStartMs,
				weekEndMs,
				publishedCount: shifts.length,
			},
			userId,
		});

		return [{ publishedCount: shifts.length }, null];
	},
});

export const upsertTableAssignment = mutation({
	args: {
		shiftId: v.id(TABLE.SHIFTS),
		tableId: v.id(TABLE.TABLES),
		startsAt: v.number(),
		endsAt: v.number(),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"shiftTableAssignments">, AuthE | NotFoundErrorObject | UserInputValidationErrorObject> {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		const shift = await ctx.db.get(args.shiftId);
		if (!shift) return [null, new NotFoundError("Shift not found").toObject()];
		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, userId, shift.restaurantId);
		if (aerr) return [null, aerr];

		if (args.endsAt <= args.startsAt) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "endsAt", message: "Must be after startsAt" }],
				}).toObject(),
			];
		}

		const table = await ctx.db.get(args.tableId);
		if (!table || table.restaurantId !== shift.restaurantId) {
			return [null, new NotFoundError("Table not found").toObject()];
		}

		const windowStart = Math.max(args.startsAt, shift.startsAt);
		const windowEnd = Math.min(args.endsAt, shift.endsAt);
		if (windowEnd <= windowStart) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "startsAt", message: "Assignment must overlap the shift window" }],
				}).toObject(),
			];
		}

		const others = await ctx.db
			.query(TABLE.SHIFT_TABLE_ASSIGNMENTS)
			.withIndex("by_table_time", (q) => q.eq("tableId", args.tableId))
			.collect();
		for (const o of others) {
			if (o.shiftId === args.shiftId) continue;
			if (rangesOverlap(o.startsAt, o.endsAt, windowStart, windowEnd)) {
				return [
					null,
					new UserInputValidationError({
						fields: [{ field: "tableId", message: "Table already covered in this window" }],
					}).toObject(),
				];
			}
		}

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.SHIFT_TABLE_ASSIGNMENTS, {
			shiftId: args.shiftId,
			restaurantId: shift.restaurantId,
			tableId: args.tableId,
			startsAt: windowStart,
			endsAt: windowEnd,
			createdBy: userId,
			createdAt: now,
			updatedAt: now,
			updatedBy: userId,
		});

		return [id, null];
	},
});

// ============================================================================
// Shift -> section assignments (the post-sections-rollout authoritative
// surface for waiter attribution; mirrors the upsertTableAssignment shape).
// ============================================================================

export const upsertSectionAssignment = mutation({
	args: {
		shiftId: v.id(TABLE.SHIFTS),
		sectionId: v.id(TABLE.SECTIONS),
		startsAt: v.number(),
		endsAt: v.number(),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<
		Id<"shiftSectionAssignments">,
		AuthE | NotFoundErrorObject | UserInputValidationErrorObject
	> {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		const shift = await ctx.db.get(args.shiftId);
		if (!shift) return [null, new NotFoundError("Shift not found").toObject()];
		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, userId, shift.restaurantId);
		if (aerr) return [null, aerr];

		if (args.endsAt <= args.startsAt) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "endsAt", message: "Must be after startsAt" }],
				}).toObject(),
			];
		}

		const section = await ctx.db.get(args.sectionId);
		if (!section || section.restaurantId !== shift.restaurantId) {
			return [null, new NotFoundError("Section not found").toObject()];
		}

		const windowStart = Math.max(args.startsAt, shift.startsAt);
		const windowEnd = Math.min(args.endsAt, shift.endsAt);
		if (windowEnd <= windowStart) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "startsAt", message: "Assignment must overlap the shift window" }],
				}).toObject(),
			];
		}

		const others = await ctx.db
			.query(TABLE.SHIFT_SECTION_ASSIGNMENTS)
			.withIndex("by_section_time", (q) => q.eq("sectionId", args.sectionId))
			.collect();
		for (const o of others) {
			if (o.shiftId === args.shiftId) continue;
			if (rangesOverlap(o.startsAt, o.endsAt, windowStart, windowEnd)) {
				return [
					null,
					new UserInputValidationError({
						fields: [
							{ field: "sectionId", message: "Section already covered in this window" },
						],
					}).toObject(),
				];
			}
		}

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.SHIFT_SECTION_ASSIGNMENTS, {
			shiftId: args.shiftId,
			restaurantId: shift.restaurantId,
			sectionId: args.sectionId,
			startsAt: windowStart,
			endsAt: windowEnd,
			createdBy: userId,
			createdAt: now,
			updatedAt: now,
			updatedBy: userId,
		});

		return [id, null];
	},
});

export const removeSectionAssignment = mutation({
	args: { assignmentId: v.id(TABLE.SHIFT_SECTION_ASSIGNMENTS) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<null, AuthE | NotFoundErrorObject> {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		const assignment = await ctx.db.get(args.assignmentId);
		if (!assignment) return [null, new NotFoundError("Assignment not found").toObject()];

		const [, aerr] = await requireRestaurantManagerOrAbove(
			ctx,
			userId,
			assignment.restaurantId
		);
		if (aerr) return [null, aerr];

		await ctx.db.delete(args.assignmentId);
		return [null, null];
	},
});

export const listSectionAssignmentsForShift = query({
	args: { shiftId: v.id(TABLE.SHIFTS) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<Doc<"shiftSectionAssignments">[], AuthE | NotFoundErrorObject> {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		const shift = await ctx.db.get(args.shiftId);
		if (!shift) return [null, new NotFoundError("Shift not found").toObject()];

		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, userId, shift.restaurantId);
		if (aerr) return [null, aerr];

		const rows = await ctx.db
			.query(TABLE.SHIFT_SECTION_ASSIGNMENTS)
			.withIndex("by_shift", (q) => q.eq("shiftId", args.shiftId))
			.collect();
		return [rows, null];
	},
});

// ============================================================================
// Bulk clear: preview + execute
// ============================================================================

const BULK_CLEAR_SCOPE = v.union(
	v.literal("thisWeek"),
	v.literal("futureWeeks"),
	v.literal("all")
);

function scopeToRange(
	scope: "thisWeek" | "futureWeeks" | "all",
	weekStartMs: number
): { fromMs: number; toMs: number | null } {
	const weekEndMs = weekStartMs + ONE_WEEK_MS;
	switch (scope) {
		case "thisWeek":
			return { fromMs: weekStartMs, toMs: weekEndMs };
		case "futureWeeks":
			return { fromMs: weekEndMs, toMs: null };
		case "all":
			return { fromMs: weekStartMs, toMs: null };
	}
}

function isShiftInScope(
	shift: Doc<"shifts">,
	fromMs: number,
	toMs: number | null
): boolean {
	if (shift.status === SHIFT_STATUS.CANCELLED) return false;
	if (shift.startsAt < fromMs) return false;
	if (toMs != null && shift.startsAt >= toMs) return false;
	return true;
}

async function countMemberShiftsInScope(
	ctx: { db: QueryCtx["db"] },
	memberId: Id<"restaurantMembers">,
	fromMs: number,
	toMs: number | null
): Promise<number> {
	const shifts = await ctx.db
		.query(TABLE.SHIFTS)
		.withIndex("by_member_time", (q) => q.eq("memberId", memberId))
		.collect();
	return shifts.filter((s) => isShiftInScope(s, fromMs, toMs)).length;
}

async function countActiveTemplates(
	ctx: { db: QueryCtx["db"] },
	memberId: Id<"restaurantMembers">
): Promise<number> {
	const templates = await ctx.db
		.query(TABLE.SHIFT_TEMPLATES)
		.withIndex("by_member", (q) => q.eq("memberId", memberId))
		.collect();
	return templates.filter((t) => t.isActive).length;
}

export const previewBulkClear = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		memberIds: v.array(v.id(TABLE.RESTAURANT_MEMBERS)),
		scope: BULK_CLEAR_SCOPE,
		weekStartMs: v.number(),
	},
	handler: async (ctx, args) => {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (aerr) return [null, aerr];

		const { fromMs, toMs } = scopeToRange(args.scope, args.weekStartMs);
		const shiftCounts = await Promise.all(
			args.memberIds.map((id) => countMemberShiftsInScope(ctx, id, fromMs, toMs))
		);
		const templateCounts = await Promise.all(
			args.memberIds.map((id) => countActiveTemplates(ctx, id))
		);
		const shiftCount = shiftCounts.reduce((a, b) => a + b, 0);
		const templateCount = templateCounts.reduce((a, b) => a + b, 0);

		return [{ shiftCount, templateCount }, null];
	},
});

async function cancelShiftsInScope(
	ctx: MutationCtx,
	memberId: Id<"restaurantMembers">,
	fromMs: number,
	toMs: number | null,
	actorId: string
): Promise<number> {
	const shifts = await ctx.db
		.query(TABLE.SHIFTS)
		.withIndex("by_member_time", (q) => q.eq("memberId", memberId))
		.collect();
	let count = 0;
	for (const s of shifts) {
		if (!isShiftInScope(s, fromMs, toMs)) continue;
		await ctx.db.patch(s._id, {
			status: SHIFT_STATUS.CANCELLED,
			templateId: undefined,
			...stampUpdated(actorId),
		});
		count++;
	}
	return count;
}

async function deactivateMemberTemplates(
	ctx: MutationCtx,
	memberId: Id<"restaurantMembers">,
	actorId: string
): Promise<number> {
	const templates = await ctx.db
		.query(TABLE.SHIFT_TEMPLATES)
		.withIndex("by_member", (q) => q.eq("memberId", memberId))
		.collect();
	let count = 0;
	for (const tmpl of templates) {
		if (!tmpl.isActive) continue;
		await ctx.db.patch(tmpl._id, {
			isActive: false,
			...stampUpdated(actorId),
		});
		count++;
	}
	return count;
}

export const bulkClearMemberSchedules = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		memberIds: v.array(v.id(TABLE.RESTAURANT_MEMBERS)),
		scope: BULK_CLEAR_SCOPE,
		weekStartMs: v.number(),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<
		{ cancelledShiftCount: number; deactivatedTemplateCount: number },
		AuthE | NotFoundErrorObject
	> {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (aerr) return [null, aerr];

		for (const memberId of args.memberIds) {
			const member = await loadActiveMember(ctx, memberId, args.restaurantId);
			if (!member) {
				return [null, new NotFoundError(`Member ${memberId} not found`).toObject()];
			}
			const [, permErr] = await requireShiftTargetAuthority(ctx, userId, {
				restaurantId: args.restaurantId,
				targetMember: member,
			});
			if (permErr) return [null, permErr];
		}

		const { fromMs, toMs } = scopeToRange(args.scope, args.weekStartMs);
		let cancelledShiftCount = 0;
		let deactivatedTemplateCount = 0;

		for (const memberId of args.memberIds) {
			cancelledShiftCount += await cancelShiftsInScope(ctx, memberId, fromMs, toMs, userId);
			deactivatedTemplateCount += await deactivateMemberTemplates(ctx, memberId, userId);
		}

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.SHIFTS,
			aggregateId: args.restaurantId,
			eventType: "shifts.bulk_cleared",
			payload: {
				restaurantId: args.restaurantId,
				memberIds: args.memberIds,
				scope: args.scope,
				weekStartMs: args.weekStartMs,
				cancelledShiftCount,
				deactivatedTemplateCount,
			},
			userId,
		});

		return [{ cancelledShiftCount, deactivatedTemplateCount }, null];
	},
});

/** For CSV export actions — caller must pass an authenticated acting user id. */
export const internalListShiftsForExport = internalQuery({
	args: {
		actingUserId: v.string(),
		restaurantId: v.id(TABLE.RESTAURANTS),
		fromMs: v.number(),
		toMs: v.number(),
	},
	handler: async (ctx, args) => {
		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, args.actingUserId, args.restaurantId);
		if (aerr) throw new Error("Unauthorized");

		const shifts = await ctx.db
			.query(TABLE.SHIFTS)
			.withIndex("by_restaurant_time", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		return shifts.filter((s) => rangesOverlap(s.startsAt, s.endsAt, args.fromMs, args.toMs));
	},
});
