/**
 * Materialised "most popular items" ranking (TAVLI-98).
 *
 * Feeds the carousel at the top of the diner menu. Recomputed nightly rather
 * than on read, because the menu is the most-loaded page in the product and
 * computing this live would walk every paid order in the window on every view
 * — an unbounded read that hits Convex's 4,096-document ceiling on a busy
 * restaurant (the class of problem TAVLI-89 tracks).
 *
 * ## The read budget, and the cap that keeps it honest
 *
 * A Convex function may issue roughly 4,096 `db.get` / `db.query` calls. The
 * shape here is one query for the orders plus one per order for its lines,
 * because `orderItems` is indexed only `by_order` — there is no
 * restaurant-scoped index to walk instead.
 *
 * So the order scan is capped at {@link ORDER_SCAN_LIMIT}, leaving a wide
 * margin under the ceiling. Past that cap the ranking is computed over the
 * *most recent* N orders rather than the full window, which is a perfectly
 * good popularity signal — arguably a fresher one. It is logged rather than
 * silently truncated, because "we sampled" and "we counted everything" are
 * different claims and the row does not record which one it is.
 *
 * ## Why one restaurant per row of work
 *
 * Each restaurant is its own mutation. A single mutation looping over every
 * restaurant would blow the same limits it was written to respect, and one
 * restaurant with pathological data would take the whole sweep down with it.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, query } from "./_generated/server";
import { TABLE } from "./constants";

/** How far back the ranking looks. */
const WINDOW_DAYS = 30;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Most orders examined per restaurant per run. Each one costs a query for its
 * lines, so this is the number that keeps the function inside its read budget.
 */
const ORDER_SCAN_LIMIT = 1_500;

/** How many items the carousel can show. */
export const POPULARITY_TOP_N = 10;

/**
 * Below this many qualifying items the carousel does not render at all.
 *
 * Three cards do not read as "our most popular" — they read as a broken
 * carousel, and a restaurant that has just opened would show one lonely dish
 * on the most prominent strip of its menu.
 */
export const POPULARITY_MIN_ITEMS = 4;

/** Restaurants processed per sweep tick. */
const RESTAURANTS_PER_SWEEP = 25;

// ============================================================================
// Recompute
// ============================================================================

/**
 * Whether an order's lines should count toward popularity.
 *
 * Paid only. A draft that was never paid is a diner browsing, and an
 * `awaiting_payment` order is money owed rather than a sale — counting either
 * would let anyone inflate a dish's rank by building carts they never submit.
 */
function countsTowardPopularity(order: Doc<"orders">): boolean {
	return order.paidAt !== undefined;
}

export const recomputeForRestaurant = internalMutation({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	returns: v.object({
		ranked: v.number(),
		ordersScanned: v.number(),
		truncated: v.boolean(),
	}),
	handler: async (ctx, args) => {
		const now = Date.now();
		const windowStartAt = now - WINDOW_MS;

		// Convex appends `_creationTime` to every index, so `by_restaurant`
		// supports a range on it without a dedicated time index. Newest first,
		// so if the cap bites we keep the most recent orders rather than an
		// arbitrary slice.
		const orders = await ctx.db
			.query(TABLE.ORDERS)
			.withIndex("by_restaurant", (q) =>
				q.eq("restaurantId", args.restaurantId).gte("_creationTime", windowStartAt)
			)
			.order("desc")
			.take(ORDER_SCAN_LIMIT);

		const truncated = orders.length === ORDER_SCAN_LIMIT;

		const quantities = new Map<Id<"menuItems">, number>();
		let ordersScanned = 0;

		for (const order of orders) {
			if (!countsTowardPopularity(order)) continue;
			ordersScanned++;
			const items = await ctx.db
				.query(TABLE.ORDER_ITEMS)
				.withIndex("by_order", (q) => q.eq("orderId", order._id))
				.collect();
			for (const item of items) {
				// An 86'd line was never served. Counting it would rank a dish
				// the kitchen could not make.
				if (item.cancelledAt !== undefined) continue;
				quantities.set(item.menuItemId, (quantities.get(item.menuItemId) ?? 0) + item.quantity);
			}
		}

		const ranked = [...quantities.entries()]
			.sort((a, b) => {
				// Quantity desc, then id asc. The tiebreak is not cosmetic: two
				// dishes on equal sales would otherwise swap places every night
				// on Map iteration order, and a carousel that reshuffles for no
				// reason looks broken.
				if (b[1] !== a[1]) return b[1] - a[1];
				return a[0] < b[0] ? -1 : 1;
			})
			.slice(0, POPULARITY_TOP_N);

		await replaceRanking(ctx, args.restaurantId, ranked, windowStartAt, now);

		if (truncated) {
			// Never a silent cap: the stored row cannot tell a reader whether it
			// counted the window or sampled it.
			console.warn(
				`[menuItemPopularity] ${args.restaurantId}: hit the ${ORDER_SCAN_LIMIT}-order scan cap; ` +
					`ranked over the most recent orders rather than the full ${WINDOW_DAYS}-day window.`
			);
		}

		return { ranked: ranked.length, ordersScanned, truncated };
	},
});

/**
 * Swap in a new ranking.
 *
 * Rewrites in place instead of delete-all-then-insert: a mutation is atomic,
 * so no reader can observe the empty middle either way — but reusing rows
 * keeps the document ids stable, which means the carousel's React keys do not
 * change and it does not re-animate every night for no reason.
 */
async function replaceRanking(
	ctx: MutationCtx,
	restaurantId: Id<"restaurants">,
	ranked: ReadonlyArray<readonly [Id<"menuItems">, number]>,
	windowStartAt: number,
	computedAt: number
): Promise<void> {
	const existing = await ctx.db
		.query(TABLE.MENU_ITEM_POPULARITY)
		.withIndex("by_restaurant_rank", (q) => q.eq("restaurantId", restaurantId))
		.collect();

	for (let i = 0; i < ranked.length; i++) {
		const [menuItemId, quantity] = ranked[i];
		const row = { menuItemId, quantity, rank: i + 1, windowStartAt, computedAt };
		const reusable = existing[i];
		if (reusable) await ctx.db.patch(reusable._id, row);
		else await ctx.db.insert(TABLE.MENU_ITEM_POPULARITY, { restaurantId, ...row });
	}

	// A menu that shrank leaves stale rows at the tail.
	for (const stale of existing.slice(ranked.length)) {
		await ctx.db.delete(stale._id);
	}
}

// ============================================================================
// Sweep
// ============================================================================

/**
 * Nightly ranking refresh, one mutation per restaurant.
 *
 * Fans out with `ctx.scheduler` rather than looping inline so each
 * restaurant's read budget is its own — an inline loop would share one budget
 * across every restaurant and fail the whole sweep on the first busy one.
 */
export const sweepPopularity = internalMutation({
	args: { cursor: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const page = await ctx.db
			.query(TABLE.RESTAURANTS)
			.paginate({ numItems: RESTAURANTS_PER_SWEEP, cursor: args.cursor ?? null });

		let scheduled = 0;
		for (const restaurant of page.page) {
			// Soft-deleted restaurants are in their retention window and have no
			// diners; ranking them is work nobody will ever see.
			if (restaurant.deletedAt != null || !restaurant.isActive) continue;
			await ctx.scheduler.runAfter(0, internal.menuItemPopularity.recomputeForRestaurant, {
				restaurantId: restaurant._id,
			});
			scheduled++;
		}

		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, internal.menuItemPopularity.sweepPopularity, {
				cursor: page.continueCursor,
			});
		}

		return { scheduled, done: page.isDone };
	},
});

// ============================================================================
// Read
// ============================================================================

/**
 * The ranked item ids for one restaurant, most popular first.
 *
 * Ids only. The carousel resolves them against the menu items the browser has
 * already loaded, which buys three things a fatter query would not:
 *
 * - the resolved objects are exactly the `MenuItemWithImage` the detail sheet
 *   takes, so tapping a card opens the same sheet a grid tap opens with no
 *   second shape to keep in sync;
 * - availability and photographs are read from *live* data, so a dish 86'd at
 *   lunch disappears from the carousel immediately rather than at midnight;
 * - an item that is popular but not on the menu currently being browsed is
 *   skipped, so the carousel never offers something the diner cannot add.
 */
export const getPopularItemIds = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	returns: v.array(v.id(TABLE.MENU_ITEMS)),
	handler: async (ctx, args): Promise<Id<"menuItems">[]> => {
		const ranked = await ctx.db
			.query(TABLE.MENU_ITEM_POPULARITY)
			.withIndex("by_restaurant_rank", (q) => q.eq("restaurantId", args.restaurantId))
			.order("asc")
			.take(POPULARITY_TOP_N);
		return ranked.map((row) => row.menuItemId);
	},
});
