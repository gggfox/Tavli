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
 * System Default section:
 *   - Auto-created by `restaurants.create` (and lazily by `backfillDefault`).
 *   - `isSystem: true`, undeletable, always renamable.
 *
 * Phase 1 rollout (see plan):
 *   - `tables.sectionId` is `v.optional` in the schema; `backfillDefault`
 *     patches existing rows. Phase 2 will tighten the schema.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
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
import { getCurrentUserId, requireOwnerOrManager } from "./_util/auth";
import { TABLE } from "./constants";

type AuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;
type SectionMutationErrors =
	| AuthErrors
	| NotFoundErrorObject
	| UserInputValidationErrorObject;

const DEFAULT_SECTION_NAME = "Default";

/**
 * Create the system Default section for a restaurant. Idempotent: returns
 * the existing system section if one is already present.
 *
 * Used by `restaurants.create` and `backfillDefault`.
 */
export async function ensureDefaultSection(
	ctx: MutationCtx,
	args: { restaurantId: Id<"restaurants">; userId: string }
): Promise<Id<"sections">> {
	const existing = await ctx.db
		.query(TABLE.SECTIONS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
		.collect();

	const systemRow = existing.find((s) => s.isSystem === true);
	if (systemRow) return systemRow._id;

	const now = Date.now();
	const nextOrder = existing.reduce((max, s) => Math.max(max, s.displayOrder), -1) + 1;
	return await ctx.db.insert(TABLE.SECTIONS, {
		restaurantId: args.restaurantId,
		name: DEFAULT_SECTION_NAME,
		displayOrder: nextOrder,
		isActive: true,
		isSystem: true,
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
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"sections">, SectionMutationErrors> {
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

		const maxOrder = siblings.reduce((max, s) => Math.max(max, s.displayOrder), -1);
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
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"sections">, SectionMutationErrors> {
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

export const remove = mutation({
	args: { sectionId: v.id(TABLE.SECTIONS) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<null, SectionMutationErrors> {
		const [userId, authErr] = await getCurrentUserId(ctx);
		if (authErr) return [null, authErr];

		const section = await ctx.db.get(args.sectionId);
		if (!section) return [null, new NotFoundError("Section not found").toObject()];

		const [, permErr] = await requireOwnerOrManager(ctx, userId, section.restaurantId);
		if (permErr) return [null, permErr];

		if (section.isSystem === true) {
			return [
				null,
				new UserInputValidationError({
					fields: [
						{ field: "sectionId", message: "Default section cannot be deleted" },
					],
				}).toObject(),
			];
		}

		const tablesInSection = await ctx.db
			.query(TABLE.TABLES)
			.withIndex("by_section", (q) => q.eq("sectionId", args.sectionId))
			.collect();
		if (tablesInSection.length > 0) {
			return [
				null,
				new UserInputValidationError({
					fields: [
						{
							field: "sectionId",
							message: `Move ${tablesInSection.length} table(s) to another section first`,
						},
					],
				}).toObject(),
			];
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

		await ctx.db.delete(args.sectionId);
		return [null, null];
	},
});

export const assignTable = mutation({
	args: {
		tableId: v.id(TABLE.TABLES),
		sectionId: v.id(TABLE.SECTIONS),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"tables">, SectionMutationErrors> {
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

		const [, permErr] = await requireOwnerOrManager(ctx, userId, table.restaurantId);
		if (permErr) return [null, permErr];

		await ctx.db.patch(args.tableId, { sectionId: args.sectionId });
		return [args.tableId, null];
	},
});

export const getByRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args): Promise<Doc<"sections">[]> => {
		const sections = await ctx.db
			.query(TABLE.SECTIONS)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.collect();
		return sections.sort((a, b) => a.displayOrder - b.displayOrder);
	},
});

/**
 * Idempotent backfill that ensures:
 *  1) The restaurant has an `isSystem: true` Default section.
 *  2) Every table in the restaurant whose `sectionId` is unset points at the
 *     Default section.
 *  3) Existing `shiftTableAssignments` rows are converted into one
 *     `shiftSectionAssignments` row per (shift, section) pair, preserving the
 *     widest combined window from the source rows. Past coverage is preserved
 *     so historical attribution lookups still work.
 *
 * Safe to re-run: only inserts the Default if missing, only patches tables
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
				(e) =>
					e.sectionId === w.sectionId &&
					e.startsAt === w.startsAt &&
					e.endsAt === w.endsAt
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

		return [
			{ defaultSectionId, tablesPatched, assignmentsConverted },
			null,
		];
	},
});
