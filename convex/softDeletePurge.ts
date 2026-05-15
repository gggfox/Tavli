/**
 * Hard-purge sweep for soft-deleted sections and tables.
 *
 * Sections and tables are soft-deleted (their `deletedAt`/`hardDeleteAfterAt`
 * fields are stamped) by `sections.remove` and `tables.remove`. The cron
 * registered in `crons.ts` invokes `purgeExpiredSoftDeletes` periodically;
 * rows whose `hardDeleteAfterAt` has elapsed are hard-deleted and an audit
 * event is appended to `allEvents` so the original payload is preserved.
 *
 * Internal mutations `purgeSectionInternal` / `purgeTableInternal` exist so
 * tests can force a purge without waiting on the retention window.
 */
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { appendAuditEvent } from "./_util/audit";
import { AUDIT_SYSTEM_USER_ID, TABLE } from "./constants";

const PURGE_BATCH_SIZE = 25;

export async function executeHardPurgeSection(
	ctx: MutationCtx,
	sectionId: Id<"sections">
): Promise<boolean> {
	const section = await ctx.db.get(sectionId);
	if (!section) return false;

	await appendAuditEvent(ctx, {
		aggregateType: TABLE.SECTIONS,
		aggregateId: String(sectionId),
		eventType: "sections.hard_deleted",
		payload: {
			restaurantId: section.restaurantId,
			name: section.name,
			displayOrder: section.displayOrder,
			isActive: section.isActive,
			deletedAt: section.deletedAt,
			deletedBy: section.deletedBy,
			hardDeleteAfterAt: section.hardDeleteAfterAt,
			createdAt: section.createdAt,
		},
		userId: AUDIT_SYSTEM_USER_ID,
	});

	await ctx.db.delete(sectionId);
	return true;
}

export async function executeHardPurgeTable(
	ctx: MutationCtx,
	tableId: Id<"tables">
): Promise<boolean> {
	const table = await ctx.db.get(tableId);
	if (!table) return false;

	await appendAuditEvent(ctx, {
		aggregateType: TABLE.TABLES,
		aggregateId: String(tableId),
		eventType: "tables.hard_deleted",
		payload: {
			restaurantId: table.restaurantId,
			tableNumber: table.tableNumber,
			label: table.label,
			capacity: table.capacity,
			sectionId: table.sectionId,
			isActive: table.isActive,
			deletedAt: table.deletedAt,
			deletedBy: table.deletedBy,
			hardDeleteAfterAt: table.hardDeleteAfterAt,
			softDeleteParentSectionId: table.softDeleteParentSectionId,
			createdAt: table.createdAt,
		},
		userId: AUDIT_SYSTEM_USER_ID,
	});

	await ctx.db.delete(tableId);
	return true;
}

async function purgeSectionIfDue(
	ctx: MutationCtx,
	sectionId: Id<"sections">,
	now: number
): Promise<boolean> {
	const section = await ctx.db.get(sectionId);
	if (!section?.deletedAt || !section.hardDeleteAfterAt) return false;
	if (section.hardDeleteAfterAt > now) return false;
	return executeHardPurgeSection(ctx, sectionId);
}

async function purgeTableIfDue(
	ctx: MutationCtx,
	tableId: Id<"tables">,
	now: number
): Promise<boolean> {
	const table = await ctx.db.get(tableId);
	if (!table?.deletedAt || !table.hardDeleteAfterAt) return false;
	if (table.hardDeleteAfterAt > now) return false;
	return executeHardPurgeTable(ctx, tableId);
}

/** Force-purge one soft-deleted section (tests). */
export const purgeSectionInternal = internalMutation({
	args: { sectionId: v.id(TABLE.SECTIONS) },
	handler: async (ctx, args) => {
		const section = await ctx.db.get(args.sectionId);
		if (!section?.deletedAt) return { purged: false as const };
		await executeHardPurgeSection(ctx, args.sectionId);
		return { purged: true as const };
	},
});

/** Force-purge one soft-deleted table (tests). */
export const purgeTableInternal = internalMutation({
	args: { tableId: v.id(TABLE.TABLES) },
	handler: async (ctx, args) => {
		const table = await ctx.db.get(args.tableId);
		if (!table?.deletedAt) return { purged: false as const };
		await executeHardPurgeTable(ctx, args.tableId);
		return { purged: true as const };
	},
});

export const purgeExpiredSoftDeletes = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();

		const sectionCandidates = await ctx.db
			.query(TABLE.SECTIONS)
			.withIndex("by_hard_delete_after", (q) => q.lte("hardDeleteAfterAt", now))
			.take(PURGE_BATCH_SIZE);

		let sectionsPurged = 0;
		for (const s of sectionCandidates) {
			if (await purgeSectionIfDue(ctx, s._id, now)) sectionsPurged++;
		}

		const tableCandidates = await ctx.db
			.query(TABLE.TABLES)
			.withIndex("by_hard_delete_after", (q) => q.lte("hardDeleteAfterAt", now))
			.take(PURGE_BATCH_SIZE);

		let tablesPurged = 0;
		for (const t of tableCandidates) {
			if (await purgeTableIfDue(ctx, t._id, now)) tablesPurged++;
		}

		return { sectionsPurged, tablesPurged };
	},
});
