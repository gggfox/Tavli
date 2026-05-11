/**
 * Shared helpers for dashboard analytics queries.
 *
 * Per-widget Convex queries call into these helpers to:
 * - validate that the date range is within the widget's max allowed window
 *   (live-query strategy needs this so we don't accidentally scan years of
 *   data); the cap is enforced server-side via `assertRangeWithin`.
 * - resolve the set of restaurant IDs the caller may aggregate over for
 *   single-restaurant or portfolio scope, with the appropriate access gate.
 *
 * Errors carry stable codes used for i18n on the client.
 */
import type { GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedError,
	NotAuthorizedErrorObject,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "../_shared/errors";
import { AsyncReturn, SyncReturn } from "../_shared/types";
import {
	getCurrentUserId,
	isAdmin,
	requireRestaurantManagerOrAbove,
	requireRestaurantStaffAccess,
} from "../_util/auth";
import { TABLE } from "../constants";

/** Convex query context limited to read-only operations. */
export type AnalyticsCtx = GenericQueryCtx<DataModel>;

export const ERROR_DASHBOARD_RANGE_TOO_LARGE = "ERROR_DASHBOARD_RANGE_TOO_LARGE";
export const ERROR_DASHBOARD_RANGE_INVALID = "ERROR_DASHBOARD_RANGE_INVALID";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type DashboardRange = { from: number; to: number };

export type DashboardWindowResult = {
	current: DashboardRange;
	comparison: DashboardRange | null;
};

/**
 * Validates `range` and constructs a comparison window of equal length ending
 * just before `range.from` when `compareToPrev` is true.
 */
export function buildWindow(
	range: DashboardRange,
	compareToPrev: boolean,
	maxRangeDays: number
): SyncReturn<DashboardWindowResult, UserInputValidationErrorObject> {
	if (
		!Number.isFinite(range.from) ||
		!Number.isFinite(range.to) ||
		range.to <= range.from
	) {
		return [
			null,
			new UserInputValidationError({
				fields: [{ field: "range", message: ERROR_DASHBOARD_RANGE_INVALID }],
			}).toObject(),
		];
	}

	const lengthMs = range.to - range.from;
	if (lengthMs > maxRangeDays * MS_PER_DAY) {
		return [
			null,
			new UserInputValidationError({
				fields: [{ field: "range", message: ERROR_DASHBOARD_RANGE_TOO_LARGE }],
			}).toObject(),
		];
	}

	const comparison: DashboardRange | null = compareToPrev
		? { from: range.from - lengthMs, to: range.from }
		: null;

	return [{ current: range, comparison }, null];
}

export type AnalyticsScopeArgs = {
	scopeKind: "restaurant" | "portfolio";
	restaurantId?: Id<"restaurants">;
};

export type AnalyticsAccessErrors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| NotFoundErrorObject;

/**
 * Resolves the list of restaurant IDs to aggregate over for the current user
 * given a scope. Restaurant scope returns `[restaurantId]` after a staff
 * access check (or manager-or-above when `requireManagerOrAbove`). Portfolio
 * scope returns the user's accessible restaurants — admins see every active
 * restaurant; non-admins see only restaurants where they have an active
 * membership (managers / employees) or they are the document owner.
 */
export async function resolveRestaurantIds(
	ctx: AnalyticsCtx,
	args: AnalyticsScopeArgs & { requireManagerOrAbove?: boolean }
): AsyncReturn<Id<"restaurants">[], AnalyticsAccessErrors> {
	const [userId, authErr] = await getCurrentUserId(ctx);
	if (authErr) return [null, authErr];

	if (args.scopeKind === "restaurant") {
		if (!args.restaurantId) {
			return [
				null,
				new NotAuthorizedError("ERROR_DASHBOARD_RESTAURANT_REQUIRED").toObject(),
			];
		}
		const accessFn = args.requireManagerOrAbove
			? requireRestaurantManagerOrAbove
			: requireRestaurantStaffAccess;
		const [, err] = await accessFn(ctx, userId, args.restaurantId);
		if (err) return [null, err];
		return [[args.restaurantId], null];
	}

	const ids = await collectAccessibleRestaurantIds(ctx, userId);
	return [ids, null];
}

async function collectAccessibleRestaurantIds(
	ctx: AnalyticsCtx,
	userId: string
): Promise<Id<"restaurants">[]> {
	const accessible = new Set<Id<"restaurants">>();

	const isUserAdmin = await isAdmin(ctx, userId);
	if (isUserAdmin) {
		const all = await ctx.db.query(TABLE.RESTAURANTS).collect();
		for (const r of all) {
			if (r.deletedAt == null && r.isActive) accessible.add(r._id);
		}
		return [...accessible];
	}

	const ownedByDoc = await ctx.db
		.query(TABLE.RESTAURANTS)
		.withIndex("by_owner", (q) => q.eq("ownerId", userId))
		.collect();
	for (const r of ownedByDoc) {
		if (r.deletedAt == null && r.isActive) accessible.add(r._id);
	}

	const memberships = await ctx.db
		.query(TABLE.RESTAURANT_MEMBERS)
		.withIndex("by_user", (q) => q.eq("userId", userId))
		.filter((q) => q.eq(q.field("isActive"), true))
		.collect();
	for (const m of memberships) {
		const r = await ctx.db.get(m.restaurantId);
		if (r && r.deletedAt == null && r.isActive) accessible.add(m.restaurantId);
	}

	return [...accessible];
}

/**
 * Loads orders for a set of restaurants whose `paidAt` (else `submittedAt`,
 * else `createdAt`) falls in `[from, to)`. Used by money / count widgets.
 */
export async function loadOrdersInRange(
	ctx: AnalyticsCtx,
	restaurantIds: Id<"restaurants">[],
	range: DashboardRange
): Promise<Doc<"orders">[]> {
	const out: Doc<"orders">[] = [];
	for (const restaurantId of restaurantIds) {
		const rows = await ctx.db
			.query(TABLE.ORDERS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
			.collect();
		for (const o of rows) {
			const t = o.paidAt ?? o.submittedAt ?? o.createdAt;
			if (t >= range.from && t < range.to) out.push(o);
		}
	}
	return out;
}

/**
 * Loads payments whose `succeededAt` (else `createdAt`) falls in `[from, to)`.
 */
export async function loadPaymentsInRange(
	ctx: AnalyticsCtx,
	restaurantIds: Id<"restaurants">[],
	range: DashboardRange
): Promise<Doc<"payments">[]> {
	const out: Doc<"payments">[] = [];
	for (const restaurantId of restaurantIds) {
		const rows = await ctx.db
			.query(TABLE.PAYMENTS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
			.collect();
		for (const p of rows) {
			const t = p.succeededAt ?? p.createdAt;
			if (t >= range.from && t < range.to) out.push(p);
		}
	}
	return out;
}

/**
 * Loads reservations starting in `[from, to)` — uses `by_restaurant_time`
 * which is range-bounded so we don't materialize the entire table.
 */
export async function loadReservationsInRange(
	ctx: AnalyticsCtx,
	restaurantIds: Id<"restaurants">[],
	range: DashboardRange
): Promise<Doc<"reservations">[]> {
	const out: Doc<"reservations">[] = [];
	for (const restaurantId of restaurantIds) {
		const rows = await ctx.db
			.query(TABLE.RESERVATIONS)
			.withIndex("by_restaurant_time", (q) =>
				q
					.eq("restaurantId", restaurantId)
					.gte("startsAt", range.from)
					.lt("startsAt", range.to)
			)
			.collect();
		out.push(...rows);
	}
	return out;
}

/**
 * Loads sessions for the given restaurants. Sessions don't have a per-time
 * index, so we collect by restaurant and filter in JS by the overlap with
 * `[from, to)` using `startedAt` / `closedAt` (closedAt = now if open).
 */
export async function loadSessionsOverlapping(
	ctx: AnalyticsCtx,
	restaurantIds: Id<"restaurants">[],
	range: DashboardRange
): Promise<Doc<"sessions">[]> {
	const out: Doc<"sessions">[] = [];
	for (const restaurantId of restaurantIds) {
		const rows = await ctx.db
			.query(TABLE.SESSIONS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
			.collect();
		for (const s of rows) {
			const start = s.startedAt;
			const end = s.closedAt ?? Date.now();
			if (end >= range.from && start < range.to) out.push(s);
		}
	}
	return out;
}
