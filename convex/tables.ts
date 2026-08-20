import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { getSoftDeletePurgeDelayMs } from "./featureFlags";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { getCurrentUserId, requireOwnerOrManager } from "./_util/auth";
import { isSessionMember } from "./_util/dinerSession";
import { FALLBACK_TABLE_CAPACITY, SESSION_STATUS, TABLE } from "./constants";
import { ensureDefaultSection } from "./sections";

type AuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

export const create = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		tableNumber: v.number(),
		label: v.optional(v.string()),
		capacity: v.optional(v.number()),
		sectionId: v.optional(v.id(TABLE.SECTIONS)),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<string, AuthErrors | UserInputValidationErrorObject | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const [, permErr] = await requireOwnerOrManager(ctx, userId, args.restaurantId);
		if (permErr) return [null, permErr];

		if (args.capacity !== undefined && args.capacity < 1) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "capacity", message: "Must be at least 1" }],
				}).toObject(),
			];
		}

		let sectionId: Id<"sections"> | undefined = args.sectionId;
		if (sectionId === undefined) {
			sectionId = await ensureDefaultSection(ctx, {
				restaurantId: args.restaurantId,
				userId,
			});
		} else {
			const section = await ctx.db.get(sectionId);
			if (section?.restaurantId !== args.restaurantId) {
				return [null, new NotFoundError("Section not found").toObject()];
			}
			if (section.deletedAt !== undefined) {
				return [
					null,
					new UserInputValidationError({
						fields: [{ field: "sectionId", message: "Cannot create a table in a deleted section" }],
					}).toObject(),
				];
			}
			if (section.isActive === false) {
				return [
					null,
					new UserInputValidationError({
						fields: [{ field: "sectionId", message: "Cannot create a table in a hidden section" }],
					}).toObject(),
				];
			}
		}

		// Only count live tables for the duplicate-number check; a soft-deleted
		// row may still share the requested number, which is fine — restore
		// would clash, but at create-time we let the new row take the seat and
		// require the user to renumber on restore if needed.
		const liveExisting = await ctx.db
			.query(TABLE.TABLES)
			.withIndex("by_restaurant_number", (q) =>
				q.eq("restaurantId", args.restaurantId).eq("tableNumber", args.tableNumber)
			)
			.collect();

		if (liveExisting.some((t) => t.deletedAt === undefined)) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "tableNumber", message: "ERROR_TABLE_NUMBER_EXISTS" }],
				}).toObject(),
			];
		}

		const id = await ctx.db.insert(TABLE.TABLES, {
			restaurantId: args.restaurantId,
			tableNumber: args.tableNumber,
			label: args.label,
			capacity: args.capacity,
			sectionId,
			isActive: true,
			createdAt: Date.now(),
		});

		return [id, null];
	},
});

export const update = mutation({
	args: {
		tableId: v.id(TABLE.TABLES),
		label: v.optional(v.string()),
		tableNumber: v.optional(v.number()),
		capacity: v.optional(v.number()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<string, AuthErrors | NotFoundErrorObject | UserInputValidationErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const table = await ctx.db.get(args.tableId);
		if (!table) return [null, new NotFoundError("Table not found").toObject()];

		const [, permErr] = await requireOwnerOrManager(ctx, userId, table.restaurantId);
		if (permErr) return [null, permErr];

		if (args.capacity !== undefined && args.capacity < 1) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "capacity", message: "Must be at least 1" }],
				}).toObject(),
			];
		}

		if (args.tableNumber !== undefined && args.tableNumber !== table.tableNumber) {
			const existing = await ctx.db
				.query(TABLE.TABLES)
				.withIndex("by_restaurant_number", (q) =>
					q.eq("restaurantId", table.restaurantId).eq("tableNumber", args.tableNumber!)
				)
				.first();
			if (existing) {
				return [
					null,
					new UserInputValidationError({
						fields: [{ field: "tableNumber", message: "ERROR_TABLE_NUMBER_EXISTS" }],
					}).toObject(),
				];
			}
		}

		await ctx.db.patch(args.tableId, {
			...(args.label !== undefined && { label: args.label }),
			...(args.tableNumber !== undefined && { tableNumber: args.tableNumber }),
			...(args.capacity !== undefined && { capacity: args.capacity }),
		});

		return [args.tableId, null];
	},
});

/**
 * One-shot admin-only backfill for the `capacity` field. Sets `capacity` on
 * any row where it's missing to the provided default. Owners can run this
 * once after the rollout; safe to re-run (no-op for rows that already have
 * a capacity).
 */
export const backfillCapacity = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		defaultCapacity: v.optional(v.number()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<{ updated: number }, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const [, permErr] = await requireOwnerOrManager(ctx, userId, args.restaurantId);
		if (permErr) return [null, permErr];

		const tables = await ctx.db
			.query(TABLE.TABLES)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		const fillTo = args.defaultCapacity ?? FALLBACK_TABLE_CAPACITY;
		let updated = 0;
		for (const t of tables) {
			if (t.capacity === undefined) {
				await ctx.db.patch(t._id, { capacity: fillTo });
				updated++;
			}
		}
		return [{ updated }, null];
	},
});

/**
 * Soft-delete a table. The row is stamped with `deletedAt`/`deletedBy`/
 * `hardDeleteAfterAt` so the `softDeletePurge.purgeExpiredSoftDeletes` cron
 * can hard-purge it after the configured retention window.
 *
 * Standalone deletes leave `softDeleteParentSectionId` unset. The section-
 * cascade path in `sections.remove` is the only writer of that marker.
 */
export const remove = mutation({
	args: { tableId: v.id(TABLE.TABLES) },
	handler: async function (ctx, args): AsyncReturn<null, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const table = await ctx.db.get(args.tableId);
		if (!table) return [null, new NotFoundError("Table not found").toObject()];

		const [, permErr] = await requireOwnerOrManager(ctx, userId, table.restaurantId);
		if (permErr) return [null, permErr];

		if (table.deletedAt !== undefined) {
			return [null, null];
		}

		const now = Date.now();
		const purgeDelayMs = await getSoftDeletePurgeDelayMs(ctx);
		await ctx.db.patch(args.tableId, {
			deletedAt: now,
			deletedBy: userId,
			hardDeleteAfterAt: now + purgeDelayMs,
			softDeleteParentSectionId: undefined,
		});
		return [null, null];
	},
});

export const bulkRemove = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		tableIds: v.array(v.id(TABLE.TABLES)),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<{ removed: number }, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const [, permErr] = await requireOwnerOrManager(ctx, userId, args.restaurantId);
		if (permErr) return [null, permErr];

		const unique = [...new Set(args.tableIds)];
		const now = Date.now();
		const purgeDelayMs = await getSoftDeletePurgeDelayMs(ctx);
		let removed = 0;

		for (const tableId of unique) {
			const table = await ctx.db.get(tableId);
			if (!table || table.restaurantId !== args.restaurantId) continue;
			if (table.deletedAt !== undefined) continue;

			await ctx.db.patch(tableId, {
				deletedAt: now,
				deletedBy: userId,
				hardDeleteAfterAt: now + purgeDelayMs,
				softDeleteParentSectionId: undefined,
			});
			removed++;
		}

		return [{ removed }, null];
	},
});

/**
 * Restore a soft-deleted table. If the parent section is itself still soft-
 * deleted, the restore is rejected — restoring an orphaned table would leave
 * it floating without a visible section.
 */
export const restore = mutation({
	args: { tableId: v.id(TABLE.TABLES) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"tables">, AuthErrors | NotFoundErrorObject | UserInputValidationErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const table = await ctx.db.get(args.tableId);
		if (!table) return [null, new NotFoundError("Table not found").toObject()];

		const [, permErr] = await requireOwnerOrManager(ctx, userId, table.restaurantId);
		if (permErr) return [null, permErr];

		if (table.deletedAt === undefined) {
			return [args.tableId, null];
		}

		if (table.sectionId) {
			const section = await ctx.db.get(table.sectionId);
			if (section?.deletedAt !== undefined) {
				return [
					null,
					new UserInputValidationError({
						fields: [
							{
								field: "tableId",
								message: "Restore the parent section first",
							},
						],
					}).toObject(),
				];
			}
		}

		await ctx.db.patch(args.tableId, {
			deletedAt: undefined,
			deletedBy: undefined,
			hardDeleteAfterAt: undefined,
			softDeleteParentSectionId: undefined,
		});
		return [args.tableId, null];
	},
});

export const toggleActive = mutation({
	args: { tableId: v.id(TABLE.TABLES) },
	handler: async function (ctx, args): AsyncReturn<boolean, AuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const table = await ctx.db.get(args.tableId);
		if (!table) return [null, new NotFoundError("Table not found").toObject()];

		const [, permErr] = await requireOwnerOrManager(ctx, userId, table.restaurantId);
		if (permErr) return [null, permErr];

		const newState = !table.isActive;
		await ctx.db.patch(args.tableId, { isActive: newState });
		return [newState, null];
	},
});

/**
 * Returns the live (non-soft-deleted) tables for a restaurant. Inactive
 * (hidden) tables are included so the floor editor can render them with
 * strikethrough; downstream surfaces that should drop inactive rows
 * (reservation table picker, ordering, schedule) filter on `isActive`.
 */
export const getByRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args): Promise<Doc<"tables">[]> => {
		const tables = await ctx.db
			.query(TABLE.TABLES)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		return tables.filter((t) => t.deletedAt === undefined);
	},
});

/**
 * Returns soft-deleted tables for a restaurant, ordered by most-recently
 * deleted first. Used by the "Show recently deleted" toggle in the floor
 * editor to surface the 48h restore window.
 */
export const getDeletedForRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args): Promise<Doc<"tables">[]> => {
		const tables = await ctx.db
			.query(TABLE.TABLES)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		return tables
			.filter((t) => t.deletedAt !== undefined)
			.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
	},
});

/**
 * Returns the tables that are usable right now for new reservations / new
 * orders / new shift assignments. Excludes:
 *  - soft-deleted tables (`deletedAt` set)
 *  - inactive tables (`isActive === false`)
 *  - tables belonging to a hidden section (`section.isActive === false`)
 *  - tables belonging to a soft-deleted section
 *
 * The floor editor wants to see hidden/inactive tables, so it should use
 * `getByRestaurant` instead.
 */
export const getActiveByRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args): Promise<Doc<"tables">[]> =>
		await listActiveTables(ctx, args.restaurantId),
});

/** Shared body of `getActiveByRestaurant` — see its doc comment for the filter. */
async function listActiveTables(
	ctx: { db: DatabaseReader },
	restaurantId: Id<typeof TABLE.RESTAURANTS>
): Promise<Doc<"tables">[]> {
	const tables = await ctx.db
		.query(TABLE.TABLES)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	const sections = await ctx.db
		.query(TABLE.SECTIONS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	const hiddenOrDeletedSectionIds = new Set(
		sections.filter((s) => s.deletedAt !== undefined || s.isActive === false).map((s) => s._id)
	);
	return tables.filter(
		(t) =>
			t.isActive &&
			t.deletedAt === undefined &&
			(t.sectionId === undefined || !hiddenOrDeletedSectionIds.has(t.sectionId))
	);
}

/**
 * Which `Session`s are open at this `Table` right now. Read off the
 * `sessions.by_table_status` index, so only sessions pinned to this exact
 * table are touched — a session at another restaurant can never match,
 * because the table id is the first index component and a table belongs to
 * exactly one restaurant.
 */
async function openSessionsAtTable(
	ctx: { db: DatabaseReader },
	tableId: Id<typeof TABLE.TABLES>
): Promise<Doc<"sessions">[]> {
	return await ctx.db
		.query(TABLE.SESSIONS)
		.withIndex("by_table_status", (q) =>
			q.eq("tableId", tableId).eq("status", SESSION_STATUS.ACTIVE)
		)
		.collect();
}

/** A `Table` plus its live occupancy, as the diner's table picker sees it. */
export type TableWithOccupancy = Doc<"tables"> & {
	/** An active `Session` is pinned to this table. */
	hasOpenSession: boolean;
	/** That session is the caller's own — they opened it or joined it by code. */
	isOwnSession: boolean;
};

/**
 * The same rows as `getActiveByRestaurant`, each carrying whether a `Session`
 * is currently open at that `Table` (TAVLI-83). A sibling query rather than an
 * extra field on `getActiveByRestaurant`: the reservation timeline and the
 * table-lock manager subscribe to that one and should not be re-run every time
 * a diner opens or closes a session.
 *
 * Occupancy is derived from `session.status`, never stored on the table, so a
 * session closed at Visit close-out — or by the hourly stale sweep — releases
 * its table with no extra write.
 *
 * `isOwnSession` is what keeps the diner's own table selectable: their first
 * order pins their session to it (see `orders.createDraft`), and without this
 * their next round would find the table disabled. Membership is resolved from
 * the caller's Clerk identity rather than a session id passed in, so nobody can
 * probe where someone else's session is sitting.
 */
export const getActiveWithOccupancy = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args): Promise<TableWithOccupancy[]> => {
		// Anonymous menu browsing is allowed, so a missing identity is normal:
		// it just means no session can be the caller's own.
		const [viewerUserId] = await getCurrentUserId(ctx);
		const tables = await listActiveTables(ctx, args.restaurantId);
		return await Promise.all(
			tables.map(async (table) => {
				const sessions = await openSessionsAtTable(ctx, table._id);
				return {
					...table,
					hasOpenSession: sessions.length > 0,
					isOwnSession:
						viewerUserId !== null && sessions.some((s) => isSessionMember(s, viewerUserId)),
				};
			})
		);
	},
});

/**
 * Ids of the restaurant's tables that currently have an open `Session`. Feeds
 * the "occupied" badge on the staff floor editor, which lists tables through
 * `getByRestaurant` (inactive ones included) and only needs the id set.
 */
export const getOccupiedTableIds = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args): Promise<Id<"tables">[]> => {
		const tables = await ctx.db
			.query(TABLE.TABLES)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		const occupied: Id<"tables">[] = [];
		for (const table of tables) {
			if (table.deletedAt !== undefined) continue;
			if ((await openSessionsAtTable(ctx, table._id)).length > 0) occupied.push(table._id);
		}
		return occupied;
	},
});
