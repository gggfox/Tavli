/**
 * Hard delete (cascade) for restaurants past soft-delete retention.
 * Invoked by cron; `purgeRestaurantInternal` is for tests (skips due-date check).
 */
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { appendAuditEvent } from "./_util/audit";
import { AUDIT_SYSTEM_USER_ID, INVITATION_STATUS, TABLE } from "./constants";

const PURGE_BATCH_SIZE = 2;

export async function hardDeleteRestaurantDataTyped(
	ctx: MutationCtx,
	restaurantId: Id<"restaurants">
) {
	const invitations = await ctx.db.query(TABLE.INVITATIONS).collect();
	for (const inv of invitations) {
		if (!inv.restaurantIds.includes(restaurantId)) continue;
		const nextIds = inv.restaurantIds.filter((id) => id !== restaurantId);
		if (nextIds.length === 0) {
			await ctx.db.patch(inv._id, {
				restaurantIds: nextIds,
				status: INVITATION_STATUS.REVOKED,
				revokedAt: Date.now(),
				revokedBy: AUDIT_SYSTEM_USER_ID,
				updatedAt: Date.now(),
				updatedBy: AUDIT_SYSTEM_USER_ID,
			});
		} else {
			await ctx.db.patch(inv._id, {
				restaurantIds: nextIds,
				updatedAt: Date.now(),
				updatedBy: AUDIT_SYSTEM_USER_ID,
			});
		}
	}

	const tipPools = await ctx.db
		.query(TABLE.TIP_POOLS)
		.withIndex("by_restaurant_date", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const pool of tipPools) {
		const shares = await ctx.db
			.query(TABLE.TIP_POOL_SHARES)
			.withIndex("by_pool", (q) => q.eq("poolId", pool._id))
			.collect();
		for (const s of shares) await ctx.db.delete(s._id);
		await ctx.db.delete(pool._id);
	}
	const tipEntries = await ctx.db
		.query(TABLE.TIP_ENTRIES)
		.withIndex("by_restaurant_date", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const e of tipEntries) await ctx.db.delete(e._id);

	const shifts = await ctx.db
		.query(TABLE.SHIFTS)
		.withIndex("by_restaurant_time", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const shift of shifts) {
		const attendance = await ctx.db
			.query(TABLE.SHIFT_ATTENDANCE)
			.withIndex("by_shift", (q) => q.eq("shiftId", shift._id))
			.collect();
		for (const a of attendance) await ctx.db.delete(a._id);

		const assignments = await ctx.db
			.query(TABLE.SHIFT_TABLE_ASSIGNMENTS)
			.withIndex("by_shift", (q) => q.eq("shiftId", shift._id))
			.collect();
		for (const as of assignments) await ctx.db.delete(as._id);

		await ctx.db.delete(shift._id);
	}

	const clockEvents = await ctx.db
		.query(TABLE.CLOCK_EVENTS)
		.withIndex("by_restaurant_time", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const ev of clockEvents) await ctx.db.delete(ev._id);

	const absences = await ctx.db
		.query(TABLE.ABSENCES)
		.withIndex("by_restaurant_date_status", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const a of absences) await ctx.db.delete(a._id);

	const members = await ctx.db
		.query(TABLE.RESTAURANT_MEMBERS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const m of members) await ctx.db.delete(m._id);

	const menus = await ctx.db
		.query(TABLE.MENUS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();

	for (const menu of menus) {
		const categories = await ctx.db
			.query(TABLE.MENU_CATEGORIES)
			.withIndex("by_menu", (q) => q.eq("menuId", menu._id))
			.collect();

		for (const category of categories) {
			const items = await ctx.db
				.query(TABLE.MENU_ITEMS)
				.withIndex("by_category", (q) => q.eq("categoryId", category._id))
				.collect();
			for (const item of items) {
				const links = await ctx.db
					.query(TABLE.MENU_ITEM_OPTION_GROUPS)
					.withIndex("by_menuItem", (q) => q.eq("menuItemId", item._id))
					.collect();
				for (const link of links) await ctx.db.delete(link._id);
				if (item.imageStorageId) await ctx.storage.delete(item.imageStorageId);
				await ctx.db.delete(item._id);
			}
			await ctx.db.delete(category._id);
		}
		await ctx.db.delete(menu._id);
	}

	const groups = await ctx.db
		.query(TABLE.OPTION_GROUPS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();

	for (const group of groups) {
		const options = await ctx.db
			.query(TABLE.OPTIONS)
			.withIndex("by_optionGroup", (q) => q.eq("optionGroupId", group._id))
			.collect();
		for (const option of options) await ctx.db.delete(option._id);

		const links = await ctx.db
			.query(TABLE.MENU_ITEM_OPTION_GROUPS)
			.withIndex("by_optionGroup", (q) => q.eq("optionGroupId", group._id))
			.collect();
		for (const link of links) await ctx.db.delete(link._id);

		await ctx.db.delete(group._id);
	}

	const locks = await ctx.db
		.query(TABLE.TABLE_LOCKS)
		.withIndex("by_restaurant_time", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const lock of locks) await ctx.db.delete(lock._id);

	const reservations = await ctx.db
		.query(TABLE.RESERVATIONS)
		.withIndex("by_restaurant_time", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const res of reservations) await ctx.db.delete(res._id);

	const resSettings = await ctx.db
		.query(TABLE.RESERVATION_SETTINGS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const rs of resSettings) await ctx.db.delete(rs._id);

	const orders = await ctx.db
		.query(TABLE.ORDERS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const order of orders) {
		const payments = await ctx.db
			.query(TABLE.PAYMENTS)
			.withIndex("by_order", (q) => q.eq("orderId", order._id))
			.collect();
		for (const p of payments) {
			const events = await ctx.db
				.query(TABLE.STRIPE_WEBHOOK_EVENTS)
				.withIndex("by_payment", (q) => q.eq("paymentId", p._id))
				.collect();
			for (const ev of events) await ctx.db.delete(ev._id);
			await ctx.db.delete(p._id);
		}
		const items = await ctx.db
			.query(TABLE.ORDER_ITEMS)
			.withIndex("by_order", (q) => q.eq("orderId", order._id))
			.collect();
		for (const it of items) await ctx.db.delete(it._id);
		await ctx.db.delete(order._id);
	}

	const sessions = await ctx.db
		.query(TABLE.SESSIONS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const s of sessions) await ctx.db.delete(s._id);

	const counters = await ctx.db
		.query(TABLE.ORDER_DAY_COUNTERS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const c of counters) await ctx.db.delete(c._id);

	const tables = await ctx.db
		.query(TABLE.TABLES)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const tb of tables) await ctx.db.delete(tb._id);
}

async function executeHardPurge(ctx: MutationCtx, restaurantId: Id<"restaurants">): Promise<boolean> {
	const restaurant = await ctx.db.get(restaurantId);
	if (!restaurant) return false;

	await appendAuditEvent(ctx, {
		aggregateType: TABLE.RESTAURANTS,
		aggregateId: String(restaurantId),
		eventType: "restaurants.hard_deleted",
		payload: {
			deletedBy: restaurant.deletedBy,
			deletedAt: restaurant.deletedAt,
			hardDeleteAfterAt: restaurant.hardDeleteAfterAt,
			name: restaurant.name,
			slug: restaurant.slug,
			slugBeforeSoftDelete: restaurant.slugBeforeSoftDelete,
			organizationId: restaurant.organizationId,
		},
		userId: AUDIT_SYSTEM_USER_ID,
	});

	await hardDeleteRestaurantDataTyped(ctx, restaurantId);
	await ctx.db.delete(restaurantId);
	return true;
}

async function purgeRestaurantIfDue(
	ctx: MutationCtx,
	restaurantId: Id<"restaurants">,
	now: number
): Promise<boolean> {
	const restaurant = await ctx.db.get(restaurantId);
	if (!restaurant?.deletedAt || !restaurant.hardDeleteAfterAt) return false;
	if (restaurant.hardDeleteAfterAt > now) return false;
	return executeHardPurge(ctx, restaurantId);
}

/** Force-purge one soft-deleted restaurant (tests). */
export const purgeRestaurantInternal = internalMutation({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant?.deletedAt) return { purged: false as const };
		await executeHardPurge(ctx, args.restaurantId);
		return { purged: true as const };
	},
});

export const purgeExpiredSoftDeletes = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const candidates = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_hard_delete_after", (q) => q.lte("hardDeleteAfterAt", now))
			.take(PURGE_BATCH_SIZE);

		let purged = 0;
		for (const r of candidates) {
			if (await purgeRestaurantIfDue(ctx, r._id, now)) purged++;
		}
		return { purged };
	},
});
