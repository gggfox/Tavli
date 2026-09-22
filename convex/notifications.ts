/**
 * The manager's bell (TAVLI-111).
 *
 * Public face of the `notifications` table: the internal mutation actions use to
 * fan a notification out, and the four functions the bell in the staff header
 * calls. The fan-out logic itself lives in `_util/notifications.ts` so a mutation
 * already inside a transaction (a Stripe webhook handler) can notify directly
 * instead of paying for a `runMutation` round trip.
 *
 * **Every public function here is scoped to the signed-in user by the signed-in
 * user's own id.** No function takes a `userId` argument — not as a convenience,
 * not for an admin view. A notification row is the only place in the product
 * where one person's read state is stored per row, so a `userId` parameter would
 * be an open invitation to read (or silently clear) somebody else's inbox. The
 * subject comes from `getCurrentUserId`, and a row belonging to anyone else is
 * reported as not found rather than as forbidden, so the list cannot be probed
 * for which ids exist.
 *
 * There is no admin-facing list and no cross-restaurant view: operator alerts
 * (TAVLI-109) are the surface for "a human at Tavli has to look at this", and
 * these two never mix.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { NotAuthenticatedErrorObject, NotFoundError, NotFoundErrorObject } from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { getCurrentUserId } from "./_util/auth";
import { notifyRestaurantManagers } from "./_util/notifications";
import { NOTIFICATION_KINDS, TABLE } from "./constants";

type NotificationDoc = Doc<typeof TABLE.NOTIFICATIONS>;
type NotificationId = Id<typeof TABLE.NOTIFICATIONS>;

/** Validator for the stored enum, so an action cannot invent a kind. */
const kindValidator = v.union(...NOTIFICATION_KINDS.map((kind) => v.literal(kind)));

// ============================================================================
// Fanning out (internal)
// ============================================================================

/**
 * `notifyRestaurantManagers` for callers that are not mutations.
 *
 * A Stripe webhook handler that runs as an action has no `db`, so it reaches the
 * helper through
 * `ctx.runMutation(internal.notifications.notifyRestaurantManagersInternal, …)`.
 * Internal, never public: deciding that a restaurant's managers need to hear
 * something is Tavli's own code's job, and a client-callable version would be a
 * way to write arbitrary rows into other people's bells.
 *
 * Returns how many notifications were written, so a caller can record "told 3
 * managers" (or notice that it told nobody) in its own audit event or operator
 * alert. **A Stripe-driven caller must pass `dedupeKey`** — see the helper's
 * JSDoc; a redelivered event otherwise adds a row per delivery per person.
 */
export const notifyRestaurantManagersInternal = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		kind: kindValidator,
		messageKey: v.optional(v.string()),
		messageParams: v.optional(v.record(v.string(), v.union(v.string(), v.number()))),
		href: v.optional(v.string()),
		dedupeKey: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<number> => notifyRestaurantManagers(ctx, args),
});

// ============================================================================
// The bell
// ============================================================================

/**
 * How many notifications the bell carries.
 *
 * Bounded, unlike the open half of `/admin/alerts`: a notification is news, not
 * a work item, and nobody scrolls a bell past two screens. Newest-first, so the
 * cut falls on the oldest — which by then is either read or no longer actionable.
 */
export const NOTIFICATIONS_LIST_LIMIT = 50;

/**
 * A notification as the bell reads it: the row plus its restaurant's name, so a
 * manager of two restaurants can tell which one the news is about without the
 * component running a query per row.
 */
export type NotificationListRow = NotificationDoc & {
	/** Null only if the restaurant was purged between the fan-out and this read. */
	restaurantName: string | null;
};

type ListMineErrors = NotAuthenticatedErrorObject;

/**
 * The signed-in user's notifications, newest first, capped at
 * `NOTIFICATIONS_LIST_LIMIT`.
 *
 * One indexed read on `by_user_created` — the index is prefixed on `userId`, so
 * another user's rows are not merely filtered out, they are never visited.
 * Restaurant names are resolved through a per-call cache, so twenty
 * notifications about one restaurant cost one lookup.
 */
export const listMine = query({
	args: {},
	handler: async function (ctx): AsyncReturn<NotificationListRow[], ListMineErrors> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];

		const rows = await ctx.db
			.query(TABLE.NOTIFICATIONS)
			.withIndex("by_user_created", (q) => q.eq("userId", userId))
			.order("desc")
			.take(NOTIFICATIONS_LIST_LIMIT);

		const restaurantNames = new Map<string, string | null>();
		const result: NotificationListRow[] = [];
		for (const row of rows) {
			const key = String(row.restaurantId);
			if (!restaurantNames.has(key)) {
				const restaurant = await ctx.db.get(row.restaurantId);
				restaurantNames.set(key, restaurant?.name ?? null);
			}
			result.push({ ...row, restaurantName: restaurantNames.get(key) ?? null });
		}

		return [result, null];
	},
});

type UnreadCountErrors = NotAuthenticatedErrorObject;

/**
 * The badge number: how many of the signed-in user's notifications are unread.
 *
 * Deliberately not derived from `listMine` — the badge is the one thing rendered
 * on every staff page, and counting inside the capped list would quietly stop
 * being true at the fifty-first unread row. `by_user_read` with
 * `readAt === undefined` is an indexed read of exactly the unread rows.
 */
export const unreadCount = query({
	args: {},
	handler: async function (ctx): AsyncReturn<number, UnreadCountErrors> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];

		const unread = await ctx.db
			.query(TABLE.NOTIFICATIONS)
			.withIndex("by_user_read", (q) => q.eq("userId", userId).eq("readAt", undefined))
			.collect();

		return [unread.length, null];
	},
});

type MarkReadErrors = NotAuthenticatedErrorObject | NotFoundErrorObject;

/**
 * Mark one notification read.
 *
 * Somebody else's row answers `ERROR_NOTIFICATION_NOT_FOUND`, the same as a row
 * that never existed: "forbidden" would confirm that the id is real, and an
 * inbox is exactly the thing that should not be enumerable.
 *
 * Marking an already-read row is a no-op rather than an error — clicking an item
 * you opened a second ago is a double-click, not a mistake — and the original
 * `readAt` is kept, because when you first read it is the true answer.
 */
export const markRead = mutation({
	args: { notificationId: v.id(TABLE.NOTIFICATIONS) },
	handler: async function (ctx, args): AsyncReturn<NotificationId, MarkReadErrors> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];

		const notification = await ctx.db.get(args.notificationId);
		if (!notification || notification.userId !== userId) {
			return [null, new NotFoundError("ERROR_NOTIFICATION_NOT_FOUND").toObject()];
		}
		if (notification.readAt != null) return [notification._id, null];

		await ctx.db.patch(notification._id, { readAt: Date.now() });
		return [notification._id, null];
	},
});

type MarkAllReadErrors = NotAuthenticatedErrorObject;

/**
 * Mark every unread notification of the signed-in user read, and return how
 * many were.
 *
 * Reads through `by_user_read`, so it touches the unread rows and nothing else —
 * a manager with two years of read history pays for the handful that are new.
 * Not capped at `NOTIFICATIONS_LIST_LIMIT`: "mark all read" that left rows
 * unread past the fiftieth would leave a badge nobody can clear.
 */
export const markAllRead = mutation({
	args: {},
	handler: async function (ctx): AsyncReturn<number, MarkAllReadErrors> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];

		const unread = await ctx.db
			.query(TABLE.NOTIFICATIONS)
			.withIndex("by_user_read", (q) => q.eq("userId", userId).eq("readAt", undefined))
			.collect();

		const readAt = Date.now();
		for (const row of unread) await ctx.db.patch(row._id, { readAt });

		return [unread.length, null];
	},
});
