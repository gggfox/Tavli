/**
 * Shift template CRUD + materialization.
 *
 * A `shiftTemplates` row describes a weekly recurring shift in the
 * restaurant's local timezone (`memberId`, `dayOfWeek`,
 * `startMinutesFromMidnight`, `durationMinutes`). On save / on a daily cron
 * sweep / on demand, this module materializes concrete `shifts` rows for the
 * `SHIFT_TEMPLATE_HORIZON_WEEKS` rolling window and never duplicates an
 * already-covered slot.
 *
 * Authorization:
 *   - Template CRUD reuses `requireShiftTargetAuthority` so a manager can
 *     only create / edit templates for employees, while owners + admins can
 *     target any role.
 *   - The cron sweep runs as the system user; it never re-checks per-row
 *     authorization (the original creator was already authorized).
 *
 * Lifecycle:
 *   - On `createShiftTemplate` / `updateShiftTemplate`: cancel all linked
 *     future SCHEDULED shifts (PUBLISHED ones are committed to employees and
 *     stay), then re-materialize the rolling 4-week horizon.
 *   - On `deactivateShiftTemplate`: same cancellation pass, no re-materialization.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalMutation,
	mutation,
	query,
	type MutationCtx,
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
	requireRestaurantManagerOrAbove,
	requireShiftTargetAuthority,
} from "./_util/auth";
import {
	addDaysToYmd,
	maxYmd,
	minYmd,
	utcMsToYmdInTimezone,
	ymdHmToUtcMs,
	ymdToDayOfWeekMonStart,
} from "./_util/timezone";
import {
	AUDIT_SYSTEM_USER_ID,
	SHIFT_STATUS,
	SHIFT_TEMPLATE_HORIZON_WEEKS,
	TABLE,
} from "./constants";

type AuthE = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const HORIZON_MS = SHIFT_TEMPLATE_HORIZON_WEEKS * 7 * MS_PER_DAY;
const MAX_DURATION_MIN = 24 * 60;

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
	return aStart < bEnd && bStart < aEnd;
}

function validateTemplateInput(args: {
	dayOfWeek: number;
	startMinutesFromMidnight: number;
	durationMinutes: number;
	activeFromYmd: string;
	activeUntilYmd?: string;
}): UserInputValidationErrorObject | null {
	const fields: { field: string; message: string }[] = [];
	if (
		!Number.isInteger(args.dayOfWeek) ||
		args.dayOfWeek < 0 ||
		args.dayOfWeek > 6
	) {
		fields.push({ field: "dayOfWeek", message: "Must be 0..6 (Mon=0)" });
	}
	if (
		!Number.isInteger(args.startMinutesFromMidnight) ||
		args.startMinutesFromMidnight < 0 ||
		args.startMinutesFromMidnight > 1439
	) {
		fields.push({
			field: "startMinutesFromMidnight",
			message: "Must be 0..1439",
		});
	}
	if (
		!Number.isInteger(args.durationMinutes) ||
		args.durationMinutes <= 0 ||
		args.durationMinutes > MAX_DURATION_MIN
	) {
		fields.push({ field: "durationMinutes", message: "Must be 1..1440" });
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(args.activeFromYmd)) {
		fields.push({ field: "activeFromYmd", message: "Must be YYYY-MM-DD" });
	}
	if (args.activeUntilYmd != null) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(args.activeUntilYmd)) {
			fields.push({ field: "activeUntilYmd", message: "Must be YYYY-MM-DD" });
		} else if (args.activeUntilYmd < args.activeFromYmd) {
			fields.push({
				field: "activeUntilYmd",
				message: "Must be on or after activeFromYmd",
			});
		}
	}
	if (!fields.length) return null;
	return new UserInputValidationError({ fields }).toObject();
}

/**
 * Insert any missing concrete shifts for `template` whose start times fall in
 * `[fromMs, toMs)`. Skips slots that already have any non-cancelled shift
 * overlapping the same window for the same member (so detached / hand-edited /
 * already-materialized rows are preserved).
 */
async function materializeTemplateForRange(
	ctx: MutationCtx,
	args: {
		template: Doc<"shiftTemplates">;
		restaurant: Doc<"restaurants">;
		fromMs: number;
		toMs: number;
		actorId: string;
	}
): Promise<number> {
	const { template, restaurant, fromMs, toMs, actorId } = args;
	if (!template.isActive) return 0;
	const tz = restaurant.timezone ?? "UTC";

	const startYmd = utcMsToYmdInTimezone(fromMs, tz);
	const endYmd = utcMsToYmdInTimezone(toMs, tz);
	let cursor = maxYmd(startYmd, template.activeFromYmd);
	const finalYmd = template.activeUntilYmd
		? minYmd(endYmd, template.activeUntilYmd)
		: endYmd;

	if (cursor > finalYmd) return 0;

	const existingMemberShifts = await ctx.db
		.query(TABLE.SHIFTS)
		.withIndex("by_member_time", (q) => q.eq("memberId", template.memberId))
		.collect();

	let inserted = 0;
	const now = Date.now();
	while (cursor <= finalYmd) {
		if (ymdToDayOfWeekMonStart(cursor) === template.dayOfWeek) {
			const startsAt = ymdHmToUtcMs(cursor, template.startMinutesFromMidnight, tz);
			const endsAt = startsAt + template.durationMinutes * 60_000;

			if (startsAt >= fromMs && startsAt < toMs) {
				const overlaps = existingMemberShifts.some(
					(s) =>
						s.status !== SHIFT_STATUS.CANCELLED &&
						rangesOverlap(s.startsAt, s.endsAt, startsAt, endsAt)
				);
				if (!overlaps) {
					const id = await ctx.db.insert(TABLE.SHIFTS, {
						memberId: template.memberId,
						restaurantId: template.restaurantId,
						startsAt,
						endsAt,
						shiftRole: template.shiftRole,
						status: SHIFT_STATUS.SCHEDULED,
						notes: template.notes,
						templateId: template._id,
						createdBy: actorId,
						createdAt: now,
						updatedAt: now,
						updatedBy: actorId,
					});
					existingMemberShifts.push({
						_id: id,
						_creationTime: now,
						memberId: template.memberId,
						restaurantId: template.restaurantId,
						startsAt,
						endsAt,
						shiftRole: template.shiftRole,
						status: SHIFT_STATUS.SCHEDULED,
						notes: template.notes,
						templateId: template._id,
						publishedAt: undefined,
						createdBy: actorId,
						createdAt: now,
						updatedAt: now,
						updatedBy: actorId,
					});
					inserted++;
				}
			}
		}
		cursor = addDaysToYmd(cursor, 1);
	}
	return inserted;
}

/**
 * Cancel every still-linked future SCHEDULED shift for a template. PUBLISHED
 * shifts are not touched — they're committed to employees. Detached
 * (`templateId: undefined`) shifts are not touched either.
 */
async function cancelLinkedFutureScheduledShifts(
	ctx: MutationCtx,
	args: { templateId: Id<"shiftTemplates">; actorId: string; reason: string }
): Promise<number> {
	const linked = await ctx.db
		.query(TABLE.SHIFTS)
		.withIndex("by_template", (q) => q.eq("templateId", args.templateId))
		.collect();
	const now = Date.now();
	let cancelled = 0;
	for (const s of linked) {
		if (s.status !== SHIFT_STATUS.SCHEDULED) continue;
		if (s.startsAt <= now) continue;
		await ctx.db.patch(s._id, {
			status: SHIFT_STATUS.CANCELLED,
			...stampUpdated(args.actorId),
		});
		await appendAuditEvent(ctx, {
			aggregateType: TABLE.SHIFTS,
			aggregateId: s._id,
			eventType: "shifts.cancelled",
			payload: { reason: args.reason, viaTemplateId: args.templateId },
			userId: args.actorId,
		});
		cancelled++;
	}
	return cancelled;
}

export const listForRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];
		const [, aerr] = await requireRestaurantManagerOrAbove(ctx, userId, args.restaurantId);
		if (aerr) return [null, aerr];

		const rows = await ctx.db
			.query(TABLE.SHIFT_TEMPLATES)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		return [rows, null];
	},
});

export const createShiftTemplate = mutation({
	args: {
		memberId: v.id(TABLE.RESTAURANT_MEMBERS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		dayOfWeek: v.number(),
		startMinutesFromMidnight: v.number(),
		durationMinutes: v.number(),
		shiftRole: v.optional(v.string()),
		notes: v.optional(v.string()),
		activeFromYmd: v.string(),
		activeUntilYmd: v.optional(v.string()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<
		Id<"shiftTemplates">,
		AuthE | NotFoundErrorObject | UserInputValidationErrorObject
	> {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		const inputErr = validateTemplateInput(args);
		if (inputErr) return [null, inputErr];

		const member = await ctx.db.get(args.memberId);
		if (!member || member.restaurantId !== args.restaurantId || !member.isActive) {
			return [null, new NotFoundError("Team member not found for restaurant").toObject()];
		}

		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant || restaurant.deletedAt != null) {
			return [null, new NotFoundError("Restaurant not found").toObject()];
		}

		const [, permErr] = await requireShiftTargetAuthority(ctx, userId, {
			restaurantId: args.restaurantId,
			targetMember: member,
		});
		if (permErr) return [null, permErr];

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.SHIFT_TEMPLATES, {
			memberId: args.memberId,
			restaurantId: args.restaurantId,
			organizationId: restaurant.organizationId,
			dayOfWeek: args.dayOfWeek,
			startMinutesFromMidnight: args.startMinutesFromMidnight,
			durationMinutes: args.durationMinutes,
			shiftRole: args.shiftRole,
			notes: args.notes,
			activeFromYmd: args.activeFromYmd,
			activeUntilYmd: args.activeUntilYmd,
			isActive: true,
			createdBy: userId,
			createdAt: now,
			updatedAt: now,
			updatedBy: userId,
		});

		const template = await ctx.db.get(id);
		if (template) {
			const inserted = await materializeTemplateForRange(ctx, {
				template,
				restaurant,
				fromMs: now,
				toMs: now + HORIZON_MS,
				actorId: userId,
			});
			await appendAuditEvent(ctx, {
				aggregateType: TABLE.SHIFT_TEMPLATES,
				aggregateId: id,
				eventType: "shiftTemplates.created",
				payload: { ...args, eagerMaterializedCount: inserted },
				userId,
			});
		}

		return [id, null];
	},
});

export const updateShiftTemplate = mutation({
	args: {
		templateId: v.id(TABLE.SHIFT_TEMPLATES),
		dayOfWeek: v.number(),
		startMinutesFromMidnight: v.number(),
		durationMinutes: v.number(),
		shiftRole: v.optional(v.string()),
		notes: v.optional(v.string()),
		activeFromYmd: v.string(),
		activeUntilYmd: v.optional(v.string()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<
		Id<"shiftTemplates">,
		AuthE | NotFoundErrorObject | UserInputValidationErrorObject
	> {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		const inputErr = validateTemplateInput(args);
		if (inputErr) return [null, inputErr];

		const template = await ctx.db.get(args.templateId);
		if (!template) {
			return [null, new NotFoundError("Shift template not found").toObject()];
		}

		const member = await ctx.db.get(template.memberId);
		if (!member) {
			return [null, new NotFoundError("Team member not found for restaurant").toObject()];
		}

		const restaurant = await ctx.db.get(template.restaurantId);
		if (!restaurant || restaurant.deletedAt != null) {
			return [null, new NotFoundError("Restaurant not found").toObject()];
		}

		const [, permErr] = await requireShiftTargetAuthority(ctx, userId, {
			restaurantId: template.restaurantId,
			targetMember: member,
		});
		if (permErr) return [null, permErr];

		await ctx.db.patch(args.templateId, {
			dayOfWeek: args.dayOfWeek,
			startMinutesFromMidnight: args.startMinutesFromMidnight,
			durationMinutes: args.durationMinutes,
			shiftRole: args.shiftRole,
			notes: args.notes,
			activeFromYmd: args.activeFromYmd,
			activeUntilYmd: args.activeUntilYmd,
			...stampUpdated(userId),
		});

		const cancelled = await cancelLinkedFutureScheduledShifts(ctx, {
			templateId: args.templateId,
			actorId: userId,
			reason: "shiftTemplates.updated",
		});

		const updated = await ctx.db.get(args.templateId);
		let inserted = 0;
		if (updated && updated.isActive) {
			const now = Date.now();
			inserted = await materializeTemplateForRange(ctx, {
				template: updated,
				restaurant,
				fromMs: now,
				toMs: now + HORIZON_MS,
				actorId: userId,
			});
		}

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.SHIFT_TEMPLATES,
			aggregateId: args.templateId,
			eventType: "shiftTemplates.updated",
			payload: { ...args, cancelledCount: cancelled, rematerializedCount: inserted },
			userId,
		});

		return [args.templateId, null];
	},
});

export const deactivateShiftTemplate = mutation({
	args: { templateId: v.id(TABLE.SHIFT_TEMPLATES) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<{ cancelledCount: number }, AuthE | NotFoundErrorObject> {
		const [userId, err] = await getCurrentUserId(ctx);
		if (err) return [null, err];

		const template = await ctx.db.get(args.templateId);
		if (!template) {
			return [null, new NotFoundError("Shift template not found").toObject()];
		}

		const member = await ctx.db.get(template.memberId);
		if (!member) {
			return [null, new NotFoundError("Team member not found for restaurant").toObject()];
		}

		const [, permErr] = await requireShiftTargetAuthority(ctx, userId, {
			restaurantId: template.restaurantId,
			targetMember: member,
		});
		if (permErr) return [null, permErr];

		await ctx.db.patch(args.templateId, {
			isActive: false,
			...stampUpdated(userId),
		});

		const cancelledCount = await cancelLinkedFutureScheduledShifts(ctx, {
			templateId: args.templateId,
			actorId: userId,
			reason: "shiftTemplates.deactivated",
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.SHIFT_TEMPLATES,
			aggregateId: args.templateId,
			eventType: "shiftTemplates.deactivated",
			payload: { cancelledCount },
			userId,
		});

		return [{ cancelledCount }, null];
	},
});

/**
 * Rolling cron sweep: extend the materialized horizon for every active
 * template across all restaurants. Idempotent — the per-template overlap
 * check skips slots already covered.
 */
export const materializeAllTemplates = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const fromMs = now;
		const toMs = now + HORIZON_MS;

		const templates = await ctx.db.query(TABLE.SHIFT_TEMPLATES).collect();
		const restaurantCache = new Map<string, Doc<"restaurants">>();
		let totalInserted = 0;
		for (const template of templates) {
			if (!template.isActive) continue;
			let restaurant = restaurantCache.get(template.restaurantId);
			if (!restaurant) {
				const fetched = await ctx.db.get(template.restaurantId);
				if (!fetched || fetched.deletedAt != null) continue;
				restaurant = fetched;
				restaurantCache.set(template.restaurantId, fetched);
			}
			totalInserted += await materializeTemplateForRange(ctx, {
				template,
				restaurant,
				fromMs,
				toMs,
				actorId: AUDIT_SYSTEM_USER_ID,
			});
		}
		return { totalInserted, scannedTemplates: templates.length };
	},
});
