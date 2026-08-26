/**
 * Hard delete (cascade) for restaurants past soft-delete retention.
 * Invoked by cron; `purgeRestaurantInternal` is for tests (skips due-date check).
 *
 * Coverage is structural (TAVLI-66): the cascade tallies one counter per table
 * in `RESTAURANT_PURGE_DELETED_TABLES`, typed exhaustively — adding a table to
 * that constant without cascade code here fails to typecheck, and
 * `restaurantPurgeCoverage.test.ts` fails when a restaurant-linked table is
 * missing from the constant. The per-table counts are recorded in the
 * `restaurants.hard_deleted` audit event so what a purge removed stays
 * answerable after the rows are gone.
 */
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { appendAuditEvent } from "./_util/audit";
import { BRANDING_IMAGE_SLOTS, BRANDING_SLOT_SPECS } from "./brandingImageHelpers";
import {
	AUDIT_SYSTEM_USER_ID,
	INVITATION_STATUS,
	RESTAURANT_PURGE_DELETED_TABLES,
	type RestaurantPurgeDeletedTable,
	type RestaurantPurgePatchedTable,
	TABLE,
} from "./constants";

/**
 * Restaurants purged per cron run. The cascade for one restaurant runs in a
 * single mutation (one transaction), so the real ceiling is Convex's
 * per-transaction read/write limits, not this number — a restaurant with more
 * rows than fit in one transaction cannot be purged by this cron and would
 * need a batched purge. Kept small so one oversized restaurant exhausts its
 * own call, not the whole batch.
 */
const PURGE_BATCH_SIZE = 2;

/** What one restaurant purge removed; recorded in the audit event. */
export type RestaurantPurgeSummary = {
	/** Rows hard-deleted, per table. Exhaustive over RESTAURANT_PURGE_DELETED_TABLES. */
	deleted: Record<RestaurantPurgeDeletedTable, number>;
	/** Rows patched in place (multi-restaurant rows scoped down), per table. */
	patched: Record<RestaurantPurgePatchedTable, number>;
	/** Files removed from Convex storage (menu item images, employee photos). */
	storageFilesDeleted: number;
};

export async function hardDeleteRestaurantDataTyped(
	ctx: MutationCtx,
	restaurantId: Id<"restaurants">
): Promise<RestaurantPurgeSummary> {
	// Exhaustive by type: a table added to RESTAURANT_PURGE_DELETED_TABLES but
	// missing here (or vice versa) is a compile error.
	const deleted: Record<RestaurantPurgeDeletedTable, number> = {
		[TABLE.RESTAURANT_MEMBERS]: 0,
		[TABLE.EMPLOYEE_ACCOUNTS]: 0,
		[TABLE.MENUS]: 0,
		[TABLE.MENU_CATEGORIES]: 0,
		[TABLE.MENU_ITEMS]: 0,
		[TABLE.OPTION_GROUPS]: 0,
		[TABLE.OPTIONS]: 0,
		[TABLE.MENU_ITEM_OPTION_GROUPS]: 0,
		[TABLE.TABLES]: 0,
		[TABLE.SECTIONS]: 0,
		[TABLE.SESSIONS]: 0,
		[TABLE.ORDERS]: 0,
		[TABLE.ORDER_ITEMS]: 0,
		[TABLE.ORDER_DAY_COUNTERS]: 0,
		[TABLE.SUBSTITUTION_PROPOSALS]: 0,
		[TABLE.PAYMENTS]: 0,
		[TABLE.STRIPE_WEBHOOK_EVENTS]: 0,
		[TABLE.STRIPE_DISPUTES]: 0,
		[TABLE.RESERVATIONS]: 0,
		[TABLE.TABLE_LOCKS]: 0,
		[TABLE.RESERVATION_SETTINGS]: 0,
		[TABLE.SHIFTS]: 0,
		[TABLE.SHIFT_TEMPLATES]: 0,
		[TABLE.SHIFT_TABLE_ASSIGNMENTS]: 0,
		[TABLE.SHIFT_SECTION_ASSIGNMENTS]: 0,
		[TABLE.SHIFT_ATTENDANCE]: 0,
		[TABLE.CLOCK_EVENTS]: 0,
		[TABLE.ABSENCES]: 0,
		[TABLE.TIP_POOLS]: 0,
		[TABLE.TIP_POOL_SHARES]: 0,
		[TABLE.TIP_ENTRIES]: 0,
		[TABLE.DASHBOARD_LAYOUTS]: 0,
		[TABLE.DASHBOARD_TEMPLATES]: 0,
		[TABLE.WHATSAPP_CHANNELS]: 0,
		[TABLE.WHATSAPP_CONVERSATIONS]: 0,
		[TABLE.WHATSAPP_MESSAGES]: 0,
		[TABLE.WHATSAPP_PENDING_ACTIONS]: 0,
	};
	const patched: Record<RestaurantPurgePatchedTable, number> = {
		[TABLE.INVITATIONS]: 0,
		[TABLE.USER_ROLES]: 0,
	};
	let storageFilesDeleted = 0;

	// Branding blobs live on the restaurants row itself, which the coverage
	// guard in `restaurantPurgeCoverage.test.ts` deliberately skips — it
	// introspects *tables* that reference restaurants, and the root table
	// references nothing. So these files have no automatic safety net: without
	// this loop four blobs per deleted restaurant leak forever, with a green
	// suite. `brandingPurgeCoverage.test.ts` is the field-level guard that
	// makes the omission fail instead.
	const brandingRestaurant = await ctx.db.get(restaurantId);
	if (brandingRestaurant) {
		for (const slot of BRANDING_IMAGE_SLOTS) {
			const storageId = brandingRestaurant[
				BRANDING_SLOT_SPECS[slot].columns.storageId as keyof typeof brandingRestaurant
			] as Id<"_storage"> | undefined;
			if (storageId) {
				await ctx.storage.delete(storageId);
				storageFilesDeleted++;
			}
		}
	}

	// Invitations can span several restaurants: drop the purged id, revoke when
	// none remain. Patched, never deleted.
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
		patched[TABLE.INVITATIONS]++;
	}

	// userRoles are org-scoped and outlive any one restaurant — never deleted
	// here. Their only restaurant reference is the legacy dev-role-switcher
	// array; entries pointing at the purged restaurant are scrubbed.
	const userRoles = await ctx.db.query(TABLE.USER_ROLES).collect();
	for (const role of userRoles) {
		const saved = role.devSavedMembershipRoles;
		if (!saved?.some((m) => m.restaurantId === String(restaurantId))) continue;
		await ctx.db.patch(role._id, {
			devSavedMembershipRoles: saved.filter((m) => m.restaurantId !== String(restaurantId)),
			updatedAt: Date.now(),
			updatedBy: AUDIT_SYSTEM_USER_ID,
		});
		patched[TABLE.USER_ROLES]++;
	}

	const members = await ctx.db
		.query(TABLE.RESTAURANT_MEMBERS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const m of members) await ctx.db.delete(m._id);
	deleted[TABLE.RESTAURANT_MEMBERS] += members.length;

	// PII (names + hashed PINs) — must not outlive the restaurant they belong to.
	const employeeAccounts = await ctx.db
		.query(TABLE.EMPLOYEE_ACCOUNTS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const acc of employeeAccounts) {
		if (acc.photoStorageId) {
			await ctx.storage.delete(acc.photoStorageId);
			storageFilesDeleted++;
		}
		await ctx.db.delete(acc._id);
	}
	deleted[TABLE.EMPLOYEE_ACCOUNTS] += employeeAccounts.length;

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
				deleted[TABLE.MENU_ITEM_OPTION_GROUPS] += links.length;
				if (item.imageStorageId) {
					await ctx.storage.delete(item.imageStorageId);
					storageFilesDeleted++;
				}
				await ctx.db.delete(item._id);
			}
			deleted[TABLE.MENU_ITEMS] += items.length;
			await ctx.db.delete(category._id);
		}
		deleted[TABLE.MENU_CATEGORIES] += categories.length;
		await ctx.db.delete(menu._id);
	}
	deleted[TABLE.MENUS] += menus.length;

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
		deleted[TABLE.OPTIONS] += options.length;

		// Links whose menu item was outside the menu tree above (mutations read
		// their own writes, so rows already deleted per-item are not re-counted).
		const links = await ctx.db
			.query(TABLE.MENU_ITEM_OPTION_GROUPS)
			.withIndex("by_optionGroup", (q) => q.eq("optionGroupId", group._id))
			.collect();
		for (const link of links) await ctx.db.delete(link._id);
		deleted[TABLE.MENU_ITEM_OPTION_GROUPS] += links.length;

		await ctx.db.delete(group._id);
	}
	deleted[TABLE.OPTION_GROUPS] += groups.length;

	const locks = await ctx.db
		.query(TABLE.TABLE_LOCKS)
		.withIndex("by_restaurant_time", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const lock of locks) await ctx.db.delete(lock._id);
	deleted[TABLE.TABLE_LOCKS] += locks.length;

	const reservations = await ctx.db
		.query(TABLE.RESERVATIONS)
		.withIndex("by_restaurant_time", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const res of reservations) await ctx.db.delete(res._id);
	deleted[TABLE.RESERVATIONS] += reservations.length;

	const resSettings = await ctx.db
		.query(TABLE.RESERVATION_SETTINGS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const rs of resSettings) await ctx.db.delete(rs._id);
	deleted[TABLE.RESERVATION_SETTINGS] += resSettings.length;

	// Payments are deleted via the restaurant index, NOT via orders: tab
	// payments carry only `sessionId` (orderId unset, XOR) and an orders-driven
	// walk misses them entirely.
	const payments = await ctx.db
		.query(TABLE.PAYMENTS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const p of payments) {
		const events = await ctx.db
			.query(TABLE.STRIPE_WEBHOOK_EVENTS)
			.withIndex("by_payment", (q) => q.eq("paymentId", p._id))
			.collect();
		for (const ev of events) await ctx.db.delete(ev._id);
		deleted[TABLE.STRIPE_WEBHOOK_EVENTS] += events.length;
		await ctx.db.delete(p._id);
	}
	deleted[TABLE.PAYMENTS] += payments.length;

	// Dispute rows mirror Stripe for staff visibility; the source of truth
	// stays in Stripe, so they go with the restaurant's other payment records.
	const disputes = await ctx.db
		.query(TABLE.STRIPE_DISPUTES)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const d of disputes) await ctx.db.delete(d._id);
	deleted[TABLE.STRIPE_DISPUTES] += disputes.length;

	const orders = await ctx.db
		.query(TABLE.ORDERS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const order of orders) {
		const items = await ctx.db
			.query(TABLE.ORDER_ITEMS)
			.withIndex("by_order", (q) => q.eq("orderId", order._id))
			.collect();
		for (const it of items) await ctx.db.delete(it._id);
		deleted[TABLE.ORDER_ITEMS] += items.length;
		await ctx.db.delete(order._id);
	}
	deleted[TABLE.ORDERS] += orders.length;

	const sessions = await ctx.db
		.query(TABLE.SESSIONS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const s of sessions) await ctx.db.delete(s._id);
	deleted[TABLE.SESSIONS] += sessions.length;

	// Deleted via the restaurant-prefixed index rather than per order, so
	// proposals whose order is already gone are still swept.
	const substitutionProposals = await ctx.db
		.query(TABLE.SUBSTITUTION_PROPOSALS)
		.withIndex("by_restaurant_status", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const sp of substitutionProposals) await ctx.db.delete(sp._id);
	deleted[TABLE.SUBSTITUTION_PROPOSALS] += substitutionProposals.length;

	const counters = await ctx.db
		.query(TABLE.ORDER_DAY_COUNTERS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const c of counters) await ctx.db.delete(c._id);
	deleted[TABLE.ORDER_DAY_COUNTERS] += counters.length;

	const tables = await ctx.db
		.query(TABLE.TABLES)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const tb of tables) await ctx.db.delete(tb._id);
	deleted[TABLE.TABLES] += tables.length;

	// All sections go, including individually soft-deleted ones still inside
	// their retention window. No overlap with softDeletePurge's cron: that sweep
	// re-queries by index each run, so rows removed here simply never appear as
	// its candidates (same pattern as `tables` above).
	const sections = await ctx.db
		.query(TABLE.SECTIONS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const s of sections) await ctx.db.delete(s._id);
	deleted[TABLE.SECTIONS] += sections.length;

	const shifts = await ctx.db
		.query(TABLE.SHIFTS)
		.withIndex("by_restaurant_time", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const shift of shifts) await ctx.db.delete(shift._id);
	deleted[TABLE.SHIFTS] += shifts.length;

	// Shift satellites are deleted via their own restaurant indexes rather than
	// per shift, so rows whose shift is already gone are still swept.
	const attendance = await ctx.db
		.query(TABLE.SHIFT_ATTENDANCE)
		.withIndex("by_restaurant_member_time", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const a of attendance) await ctx.db.delete(a._id);
	deleted[TABLE.SHIFT_ATTENDANCE] += attendance.length;

	const tableAssignments = await ctx.db
		.query(TABLE.SHIFT_TABLE_ASSIGNMENTS)
		.withIndex("by_restaurant_time", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const a of tableAssignments) await ctx.db.delete(a._id);
	deleted[TABLE.SHIFT_TABLE_ASSIGNMENTS] += tableAssignments.length;

	const sectionAssignments = await ctx.db
		.query(TABLE.SHIFT_SECTION_ASSIGNMENTS)
		.withIndex("by_restaurant_time", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const a of sectionAssignments) await ctx.db.delete(a._id);
	deleted[TABLE.SHIFT_SECTION_ASSIGNMENTS] += sectionAssignments.length;

	const shiftTemplates = await ctx.db
		.query(TABLE.SHIFT_TEMPLATES)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const st of shiftTemplates) await ctx.db.delete(st._id);
	deleted[TABLE.SHIFT_TEMPLATES] += shiftTemplates.length;

	const clockEvents = await ctx.db
		.query(TABLE.CLOCK_EVENTS)
		.withIndex("by_restaurant_time", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const ev of clockEvents) await ctx.db.delete(ev._id);
	deleted[TABLE.CLOCK_EVENTS] += clockEvents.length;

	const absences = await ctx.db
		.query(TABLE.ABSENCES)
		.withIndex("by_restaurant_date_status", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const a of absences) await ctx.db.delete(a._id);
	deleted[TABLE.ABSENCES] += absences.length;

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
		deleted[TABLE.TIP_POOL_SHARES] += shares.length;
		await ctx.db.delete(pool._id);
	}
	deleted[TABLE.TIP_POOLS] += tipPools.length;

	const tipEntries = await ctx.db
		.query(TABLE.TIP_ENTRIES)
		.withIndex("by_restaurant_date", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const e of tipEntries) await ctx.db.delete(e._id);
	deleted[TABLE.TIP_ENTRIES] += tipEntries.length;

	// Restaurant-scoped layouts only; portfolio layouts (restaurantId unset)
	// belong to the user across restaurants and are untouched.
	const layouts = await ctx.db
		.query(TABLE.DASHBOARD_LAYOUTS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const l of layouts) await ctx.db.delete(l._id);
	deleted[TABLE.DASHBOARD_LAYOUTS] += layouts.length;

	const templates = await ctx.db
		.query(TABLE.DASHBOARD_TEMPLATES)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const tpl of templates) await ctx.db.delete(tpl._id);
	deleted[TABLE.DASHBOARD_TEMPLATES] += templates.length;

	// WhatsApp assistant (ADR 010/011). `whatsappMessages` and
	// `whatsappPendingActions` carry a `restaurantId` but have no
	// restaurant-prefixed index, so they cascade through their conversation the
	// way order items cascade through their order.
	const conversations = await ctx.db
		.query(TABLE.WHATSAPP_CONVERSATIONS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const conversation of conversations) {
		const messages = await ctx.db
			.query(TABLE.WHATSAPP_MESSAGES)
			.withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
			.collect();
		for (const m of messages) await ctx.db.delete(m._id);
		deleted[TABLE.WHATSAPP_MESSAGES] += messages.length;

		const pendingActions = await ctx.db
			.query(TABLE.WHATSAPP_PENDING_ACTIONS)
			.withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
			.collect();
		for (const a of pendingActions) await ctx.db.delete(a._id);
		deleted[TABLE.WHATSAPP_PENDING_ACTIONS] += pendingActions.length;

		await ctx.db.delete(conversation._id);
	}
	deleted[TABLE.WHATSAPP_CONVERSATIONS] += conversations.length;

	const channels = await ctx.db
		.query(TABLE.WHATSAPP_CHANNELS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const c of channels) await ctx.db.delete(c._id);
	deleted[TABLE.WHATSAPP_CHANNELS] += channels.length;

	return { deleted, patched, storageFilesDeleted };
}

async function executeHardPurge(
	ctx: MutationCtx,
	restaurantId: Id<"restaurants">
): Promise<RestaurantPurgeSummary | null> {
	const restaurant = await ctx.db.get(restaurantId);
	if (!restaurant) return null;

	const summary = await hardDeleteRestaurantDataTyped(ctx, restaurantId);
	await ctx.db.delete(restaurantId);

	// Appended after the cascade so the event records its effect, not just the
	// decision. `allEvents` is purge-exempt, so this outlives the restaurant as
	// the only remaining record of what was removed.
	await appendAuditEvent(ctx, {
		aggregateType: TABLE.RESTAURANTS,
		aggregateId: String(restaurantId),
		eventType: "restaurants.hard_deleted",
		restaurantId,
		payload: {
			deletedBy: restaurant.deletedBy,
			deletedAt: restaurant.deletedAt,
			hardDeleteAfterAt: restaurant.hardDeleteAfterAt,
			name: restaurant.name,
			slug: restaurant.slug,
			slugBeforeSoftDelete: restaurant.slugBeforeSoftDelete,
			organizationId: restaurant.organizationId,
			counts: { [TABLE.RESTAURANTS]: 1, ...summary.deleted },
			patched: summary.patched,
			storageFilesDeleted: summary.storageFilesDeleted,
			tablesCovered: [TABLE.RESTAURANTS, ...RESTAURANT_PURGE_DELETED_TABLES],
		},
		userId: AUDIT_SYSTEM_USER_ID,
	});
	return summary;
}

async function purgeRestaurantIfDue(
	ctx: MutationCtx,
	restaurantId: Id<"restaurants">,
	now: number
): Promise<boolean> {
	const restaurant = await ctx.db.get(restaurantId);
	if (!restaurant?.deletedAt || !restaurant.hardDeleteAfterAt) return false;
	if (restaurant.hardDeleteAfterAt > now) return false;
	return (await executeHardPurge(ctx, restaurantId)) !== null;
}

/** Force-purge one soft-deleted restaurant (tests). */
export const purgeRestaurantInternal = internalMutation({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant?.deletedAt) return { purged: false as const };
		const summary = await executeHardPurge(ctx, args.restaurantId);
		return { purged: true as const, summary };
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
