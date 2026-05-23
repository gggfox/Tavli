/**
 * Floor sections (zones) CRUD + waiter attribution glue.
 *
 * Sections group tables on the floor. Waiter coverage flows through:
 *   table.sectionId -> active shiftSectionAssignments window -> shift.memberId
 *
 * Authorization:
 *   - All mutations: owner / org-owner / admin / active restaurant manager
 *     via `requireOwnerOrManager` (alias for `requireRestaurantManagerOrAbove`).
 *   - Reads: same surface.
 *
 * Section auto-create:
 *   - No section is created at restaurant-create time anymore.
 *   - `tables.create` lazily auto-creates a regular section the first time a
 *     table is added to a restaurant that has none. Auto-created sections are
 *     unnamed, fully renamable, and fully deletable.
 *
 * Legacy `isSystem: true` rows (from before the deprecation) are flattened by
 * the one-shot admin migration `removeSystemFlag`. The `isSystem` field stays
 * in the schema as `v.optional(v.boolean())` so existing data validates; we
 * just stop writing `true` to it.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
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
import { stampUpdated } from "./_util/audit";
import { getCurrentUserId, requireAdminRole, requireOwnerOrManager } from "./_util/auth";
import { TABLE } from "./constants";

type AuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;
type SectionMutationErrors = AuthErrors | NotFoundErrorObject | UserInputValidationErrorObject;

/**
 * Return the id of *some* section for the restaurant — preferring the
 * lowest-`displayOrder` existing one — or, if none exist, lazily create a
 * single regular section and return its id.
 *
 * The created section has no name (the UI renders the "Section N" fallback)
 * and no `isSystem` flag, so owners can rename or delete it like any other.
 *
 * Used by `tables.create` (lazy auto-create on first add) and
 * `sections.backfillDefault` (data migration).
 */
export async function ensureDefaultSection(
	ctx: MutationCtx,
	args: { restaurantId: Id<"restaurants">; userId: string }
): Promise<Id<"sections">> {
	const existing = await ctx.db
		.query(TABLE.SECTIONS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
		.collect();

	const live = existing.filter((s) => s.deletedAt === undefined);
	if (live.length > 0) {
		return [...live].sort((a, b) => a.displayOrder - b.displayOrder)[0]._id;
	}

	const now = Date.now();
	return await ctx.db.insert(TABLE.SECTIONS, {
		restaurantId: args.restaurantId,
		displayOrder: 0,
		isActive: true,
		createdAt: now,
		updatedAt: now,
		updatedBy: args.userId,
	});
}

export const create = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		name: v.optional(v.string()),
		displayOrder: v.optional(v.number()),
	},
	handler: async function (ctx, args): AsyncReturn<Id<"sections">, SectionMutationErrors> {
		const [userId, authErr] = await getCurrentUserId(ctx);
		if (authErr) return [null, authErr];
		const [, permErr] = await requireOwnerOrManager(ctx, userId, args.restaurantId);
		if (permErr) return [null, permErr];

		const trimmedName = args.name?.trim();
		if (trimmedName !== undefined && trimmedName.length > 60) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "name", message: "Must be 60 characters or fewer" }],
				}).toObject(),
			];
		}

		const siblings = await ctx.db
			.query(TABLE.SECTIONS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		const liveSiblings = siblings.filter((s) => s.deletedAt === undefined);
		const maxOrder = liveSiblings.reduce((max, s) => Math.max(max, s.displayOrder), -1);
		const displayOrder = args.displayOrder ?? maxOrder + 1;

		const now = Date.now();
		const id = await ctx.db.insert(TABLE.SECTIONS, {
			restaurantId: args.restaurantId,
			name: trimmedName && trimmedName.length > 0 ? trimmedName : undefined,
			displayOrder,
			isActive: true,
			createdAt: now,
			updatedAt: now,
			updatedBy: userId,
		});

		return [id, null];
	},
});

export const update = mutation({
	args: {
		sectionId: v.id(TABLE.SECTIONS),
		name: v.optional(v.string()),
		displayOrder: v.optional(v.number()),
		isActive: v.optional(v.boolean()),
	},
	handler: async function (ctx, args): AsyncReturn<Id<"sections">, SectionMutationErrors> {
		const [userId, authErr] = await getCurrentUserId(ctx);
		if (authErr) return [null, authErr];

		const section = await ctx.db.get(args.sectionId);
		if (!section) return [null, new NotFoundError("Section not found").toObject()];

		const [, permErr] = await requireOwnerOrManager(ctx, userId, section.restaurantId);
		if (permErr) return [null, permErr];

		const trimmedName = args.name?.trim();
		if (trimmedName !== undefined && trimmedName.length > 60) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "name", message: "Must be 60 characters or fewer" }],
				}).toObject(),
			];
		}

		await ctx.db.patch(args.sectionId, {
			...(args.name !== undefined && {
				name: trimmedName && trimmedName.length > 0 ? trimmedName : undefined,
			}),
			...(args.displayOrder !== undefined && { displayOrder: args.displayOrder }),
			...(args.isActive !== undefined && { isActive: args.isActive }),
			...stampUpdated(userId),
		});

		return [args.sectionId, null];
	},
});

/**
 * Soft-delete a section and cascade soft-delete its live tables.
 *
 * Tables that were live in the section at delete time get stamped with
 * `softDeleteParentSectionId = <this section>` so `restore` can pair them back.
 * Tables that were already independently soft-deleted are left alone.
 *
 * The "future shift assignments" guard from the old hard-delete is preserved:
 * if any `shiftSectionAssignments` row for this section ends in the future,
 * the operation is rejected and the user is asked to cancel coverage first.
 * Restoring the section then keeps that scheduled coverage intact.
 *
 * The hard-purge cron (`softDeletePurge.purgeExpiredSoftDeletes`) cleans up
 * after the configurable retention window elapses.
 */
export const remove = mutation({
	args: { sectionId: v.id(TABLE.SECTIONS) },
	handler: async function (ctx, args): AsyncReturn<null, SectionMutationErrors> {
		const [userId, authErr] = await getCurrentUserId(ctx);
		if (authErr) return [null, authErr];

		const section = await ctx.db.get(args.sectionId);
		if (!section) return [null, new NotFoundError("Section not found").toObject()];

		const [, permErr] = await requireOwnerOrManager(ctx, userId, section.restaurantId);
		if (permErr) return [null, permErr];

		if (section.deletedAt !== undefined) {
			return [null, null];
		}

		const now = Date.now();
		const futureAssignments = await ctx.db
			.query(TABLE.SHIFT_SECTION_ASSIGNMENTS)
			.withIndex("by_section_time", (q) => q.eq("sectionId", args.sectionId))
			.collect();
		const blocking = futureAssignments.filter((a) => a.endsAt > now);
		if (blocking.length > 0) {
			return [
				null,
				new UserInputValidationError({
					fields: [
						{
							field: "sectionId",
							message: `Cancel ${blocking.length} future shift assignment(s) first`,
						},
					],
				}).toObject(),
			];
		}

		const purgeDelayMs = await getSoftDeletePurgeDelayMs(ctx);
		const hardDeleteAfterAt = now + purgeDelayMs;

		await ctx.db.patch(args.sectionId, {
			deletedAt: now,
			deletedBy: userId,
			hardDeleteAfterAt,
			...stampUpdated(userId),
		});

		const tablesInSection = await ctx.db
			.query(TABLE.TABLES)
			.withIndex("by_section", (q) => q.eq("sectionId", args.sectionId))
			.collect();
		for (const table of tablesInSection) {
			if (table.deletedAt !== undefined) continue;
			await ctx.db.patch(table._id, {
				deletedAt: now,
				deletedBy: userId,
				hardDeleteAfterAt,
				softDeleteParentSectionId: args.sectionId,
			});
		}

		return [null, null];
	},
});

/**
 * Restore a soft-deleted section. Tables that were soft-deleted as part of
 * the cascade (their `softDeleteParentSectionId` points at this section) are
 * restored back to live state too. Tables soft-deleted independently before
 * the section was deleted stay in the trash and must be restored on their own.
 */
export const restore = mutation({
	args: { sectionId: v.id(TABLE.SECTIONS) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"sections">, AuthErrors | NotFoundErrorObject> {
		const [userId, authErr] = await getCurrentUserId(ctx);
		if (authErr) return [null, authErr];

		const section = await ctx.db.get(args.sectionId);
		if (!section) return [null, new NotFoundError("Section not found").toObject()];

		const [, permErr] = await requireOwnerOrManager(ctx, userId, section.restaurantId);
		if (permErr) return [null, permErr];

		if (section.deletedAt === undefined) {
			return [args.sectionId, null];
		}

		await ctx.db.patch(args.sectionId, {
			deletedAt: undefined,
			deletedBy: undefined,
			hardDeleteAfterAt: undefined,
			...stampUpdated(userId),
		});

		const cascadedTables = await ctx.db
			.query(TABLE.TABLES)
			.withIndex("by_soft_delete_parent", (q) => q.eq("softDeleteParentSectionId", args.sectionId))
			.collect();
		for (const table of cascadedTables) {
			if (table.deletedAt === undefined) continue;
			await ctx.db.patch(table._id, {
				deletedAt: undefined,
				deletedBy: undefined,
				hardDeleteAfterAt: undefined,
				softDeleteParentSectionId: undefined,
			});
		}

		return [args.sectionId, null];
	},
});

export const assignTable = mutation({
	args: {
		tableId: v.id(TABLE.TABLES),
		sectionId: v.id(TABLE.SECTIONS),
	},
	handler: async function (ctx, args): AsyncReturn<Id<"tables">, SectionMutationErrors> {
		const [userId, authErr] = await getCurrentUserId(ctx);
		if (authErr) return [null, authErr];

		const table = await ctx.db.get(args.tableId);
		if (!table) return [null, new NotFoundError("Table not found").toObject()];

		const section = await ctx.db.get(args.sectionId);
		if (!section) return [null, new NotFoundError("Section not found").toObject()];

		if (section.restaurantId !== table.restaurantId) {
			return [
				null,
				new UserInputValidationError({
					fields: [
						{
							field: "sectionId",
							message: "Section must belong to the same restaurant as the table",
						},
					],
				}).toObject(),
			];
		}

		if (section.deletedAt !== undefined) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "sectionId", message: "Cannot assign a table to a deleted section" }],
				}).toObject(),
			];
		}

		if (section.isActive === false) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: "sectionId", message: "Cannot assign a table to a hidden section" }],
				}).toObject(),
			];
		}

		const [, permErr] = await requireOwnerOrManager(ctx, userId, table.restaurantId);
		if (permErr) return [null, permErr];

		await ctx.db.patch(args.tableId, { sectionId: args.sectionId });
		return [args.tableId, null];
	},
});

/**
 * Returns the live (non-soft-deleted) sections for a restaurant, ordered by
 * `displayOrder`. Soft-deleted rows are excluded; callers that want to surface
 * the "recently deleted" trash should use `getDeletedForRestaurant` instead.
 *
 * Hidden sections (`isActive: false`) are included here so the floor editor
 * can show them as collapsed strips; surfaces that should not list hidden
 * sections (reservation table picker, new shift assignment dropdowns) must
 * filter by `isActive` on their end.
 */
export const getByRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args): Promise<Doc<"sections">[]> => {
		const sections = await ctx.db
			.query(TABLE.SECTIONS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		return sections
			.filter((s) => s.deletedAt === undefined)
			.sort((a, b) => a.displayOrder - b.displayOrder);
	},
});

/**
 * Returns soft-deleted sections for a restaurant, ordered by most recently
 * deleted first. Used by the "Show recently deleted" toggle in the floor
 * editor.
 */
export const getDeletedForRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args): Promise<Doc<"sections">[]> => {
		const sections = await ctx.db
			.query(TABLE.SECTIONS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		return sections
			.filter((s) => s.deletedAt !== undefined)
			.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
	},
});

/**
 * Idempotent backfill that ensures:
 *  1) The restaurant has at least one section (creates an unnamed regular
 *     section via `ensureDefaultSection` if none exist).
 *  2) Every table in the restaurant whose `sectionId` is unset points at the
 *     resolved fallback section.
 *  3) Existing `shiftTableAssignments` rows are converted into one
 *     `shiftSectionAssignments` row per (shift, section) pair, preserving the
 *     widest combined window from the source rows. Past coverage is preserved
 *     so historical attribution lookups still work.
 *
 * Safe to re-run: only inserts a section if missing, only patches tables
 * with `sectionId === undefined`, and only inserts a per-(shift, section) row
 * when no equivalent one exists.
 */
export const backfillDefault = mutation({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<
		{
			defaultSectionId: Id<"sections">;
			tablesPatched: number;
			assignmentsConverted: number;
		},
		AuthErrors | NotFoundErrorObject
	> {
		const [userId, authErr] = await getCurrentUserId(ctx);
		if (authErr) return [null, authErr];
		const [, permErr] = await requireOwnerOrManager(ctx, userId, args.restaurantId);
		if (permErr) return [null, permErr];

		const defaultSectionId = await ensureDefaultSection(ctx, {
			restaurantId: args.restaurantId,
			userId,
		});

		const tables = await ctx.db
			.query(TABLE.TABLES)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		let tablesPatched = 0;
		const tableSectionByTableId = new Map<Id<"tables">, Id<"sections">>();
		for (const t of tables) {
			if (t.sectionId === undefined) {
				await ctx.db.patch(t._id, { sectionId: defaultSectionId });
				tablesPatched++;
				tableSectionByTableId.set(t._id, defaultSectionId);
			} else {
				tableSectionByTableId.set(t._id, t.sectionId);
			}
		}

		const legacyAssignments = await ctx.db
			.query(TABLE.SHIFT_TABLE_ASSIGNMENTS)
			.withIndex("by_restaurant_time", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();

		const widest = new Map<
			string,
			{
				shiftId: Id<"shifts">;
				sectionId: Id<"sections">;
				startsAt: number;
				endsAt: number;
			}
		>();
		for (const la of legacyAssignments) {
			const sectionId = tableSectionByTableId.get(la.tableId);
			if (!sectionId) continue;
			const key = `${la.shiftId}::${sectionId}`;
			const cur = widest.get(key);
			if (cur) {
				cur.startsAt = Math.min(cur.startsAt, la.startsAt);
				cur.endsAt = Math.max(cur.endsAt, la.endsAt);
			} else {
				widest.set(key, {
					shiftId: la.shiftId,
					sectionId,
					startsAt: la.startsAt,
					endsAt: la.endsAt,
				});
			}
		}

		let assignmentsConverted = 0;
		const now = Date.now();
		for (const w of widest.values()) {
			const existing = await ctx.db
				.query(TABLE.SHIFT_SECTION_ASSIGNMENTS)
				.withIndex("by_shift", (q) => q.eq("shiftId", w.shiftId))
				.collect();
			const dup = existing.find(
				(e) => e.sectionId === w.sectionId && e.startsAt === w.startsAt && e.endsAt === w.endsAt
			);
			if (dup) continue;

			await ctx.db.insert(TABLE.SHIFT_SECTION_ASSIGNMENTS, {
				shiftId: w.shiftId,
				restaurantId: args.restaurantId,
				sectionId: w.sectionId,
				startsAt: w.startsAt,
				endsAt: w.endsAt,
				createdBy: userId,
				createdAt: now,
				updatedAt: now,
				updatedBy: userId,
			});
			assignmentsConverted++;
		}

		return [{ defaultSectionId, tablesPatched, assignmentsConverted }, null];
	},
});

/**
 * One-shot, admin-only migration that clears the legacy `isSystem: true`
 * flag from every section row in the database. After this runs, the
 * field is `undefined` everywhere — nothing else writes `true` anymore,
 * so the defensive `isSystem === true` check inside `sections.remove`
 * becomes inert.
 *
 * Idempotent: re-running scans the table again but only patches rows
 * whose flag is still set, so subsequent runs report `patched: 0`.
 */
export const removeSystemFlag = mutation({
	args: {},
	handler: async function (ctx, _args): AsyncReturn<{ patched: number }, AuthErrors> {
		const [userId, authErr] = await getCurrentUserId(ctx);
		if (authErr) return [null, authErr];
		const [, permErr] = await requireAdminRole(ctx, userId);
		if (permErr) return [null, permErr];

		const rows = await ctx.db.query(TABLE.SECTIONS).collect();
		let patched = 0;
		for (const row of rows) {
			if (row.isSystem === true) {
				await ctx.db.patch(row._id, {
					isSystem: undefined,
					...stampUpdated(userId),
				});
				patched++;
			}
		}
		return [{ patched }, null];
	},
});
