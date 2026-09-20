/**
 * Telling a restaurant's managers that their money did something (TAVLI-111).
 *
 * TAVLI-103 (failed payouts) and TAVLI-102 (disputes) both need to reach the
 * restaurant, not Tavli: a payout that bounced is the restaurant's bank account,
 * and a dispute is the restaurant's money on hold. Until now the app had no way
 * to reach them at all — operator alerts (TAVLI-109) go to Tavli's own inbox and
 * must never be mixed into a manager's bell.
 *
 * `notifyRestaurantManagers` is that way. It writes **one row per recipient**
 * rather than one row per event, because read state is personal: with a shared
 * row the best the bell could say is "somebody has read this", which is exactly
 * the wrong thing to tell the manager who has not.
 *
 * Two properties are worth naming:
 *
 * 1. **Fanned out at event time, not resolved at read time.** The recipient set
 *    is whoever managed the restaurant when the money moved. A manager hired
 *    next week does not inherit last week's failed payout — they were not there,
 *    it is not theirs to act on, and a join-at-read-time list would hand them
 *    every historical problem on their first login.
 * 2. **Employee accounts get nothing.** A `RestaurantMember` backed by an
 *    `EmployeeAccount` (ADR 006) has no Clerk identity — no `userId`, no inbox,
 *    no session that could open the bell. Its holder signs in through the
 *    restaurant's shared employee session with a Personal PIN, a surface that
 *    exists for clocking in and reading one's own tips. Writing a row for one
 *    would be a row nobody can ever read. They are also the wrong audience:
 *    a dispute is the restaurant's money, and a server can neither see the
 *    payments page nor act on a chargeback.
 *
 * `listRestaurantManagerEmails` exposes the same recipient set with the address
 * and language each person reads in, so TAVLI-103/102 can send the email
 * counterpart without re-deriving who "the managers" are. This module sends no
 * email itself.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { resolveInviteLocale, type InviteEmailLocale } from "../emails/locale";
import {
	NOTIFICATION_BODY_KEY,
	NOTIFICATION_RECIPIENT_MEMBER_ROLES,
	TABLE,
	type NotificationKind,
} from "../constants";

export type NotificationMessageParams = Record<string, string | number>;

export type NotifyRestaurantManagersArgs = {
	restaurantId: Id<"restaurants">;
	kind: NotificationKind;
	/** Defaults to the kind's `NOTIFICATION_BODY_KEY`. */
	messageKey?: string;
	messageParams?: NotificationMessageParams;
	/** In-app path the row links to, e.g. `/admin/payments`. */
	href?: string;
};

/** One recipient of the email counterpart, and the language they read in. */
export type RestaurantManagerEmailRecipient = {
	userId: string;
	email: string;
	locale: InviteEmailLocale;
};

/** Reads only, so a query can ask "who are this restaurant's managers?" too. */
type NotificationReadCtx = QueryCtx | MutationCtx;

const RECIPIENT_ROLES = new Set<string>(NOTIFICATION_RECIPIENT_MEMBER_ROLES);

/**
 * Clerk subjects of every active manager-or-above `RestaurantMember` of this
 * restaurant, de-duplicated and in a stable order.
 *
 * Indexed on `by_restaurant` — the role and the XOR half are filtered in memory
 * because a restaurant has tens of members, not thousands, and adding an index
 * per predicate on a table this small buys nothing.
 *
 * A member without `userId` is an `EmployeeAccount`-backed row (ADR 006) and is
 * skipped: see the module comment for why that is a product decision and not an
 * omission. `isActive` is required because a removed manager keeps their row —
 * `removedAt` is set and `isActive` flipped — and a former manager should stop
 * hearing about the restaurant's money the moment they are removed.
 */
async function collectRestaurantManagerUserIds(
	ctx: NotificationReadCtx,
	restaurantId: Id<"restaurants">
): Promise<string[]> {
	const members: Doc<"restaurantMembers">[] = await ctx.db
		.query(TABLE.RESTAURANT_MEMBERS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();

	const userIds: string[] = [];
	const seen = new Set<string>();
	for (const member of members) {
		if (!member.isActive) continue;
		if (!RECIPIENT_ROLES.has(member.role)) continue;
		const userId = member.userId;
		// Employee-account-backed membership: no Clerk identity, nothing to notify.
		if (!userId) continue;
		// One person, one notification — even if duplicate membership rows exist.
		if (seen.has(userId)) continue;
		seen.add(userId);
		userIds.push(userId);
	}

	return userIds;
}

/**
 * Write one notification per manager of `restaurantId`, and return how many.
 *
 * Takes a `MutationCtx` rather than being a Convex function so a webhook
 * handler already mid-transaction can notify without a `runMutation` round trip
 * — the same shape as `raiseOperatorAlert`. Actions reach it through
 * `internal.notifications.notifyRestaurantManagersInternal`.
 *
 * Returns 0 for a restaurant with no eligible manager, which is a real state
 * (a solo owner who never accepted a manager membership, a restaurant whose only
 * staff are employee accounts) and not an error: the caller's own operator alert
 * is what makes sure a human at Tavli still sees the problem.
 */
export async function notifyRestaurantManagers(
	ctx: MutationCtx,
	args: NotifyRestaurantManagersArgs
): Promise<number> {
	const userIds = await collectRestaurantManagerUserIds(ctx, args.restaurantId);
	const createdAt = Date.now();
	const messageKey = args.messageKey ?? NOTIFICATION_BODY_KEY[args.kind];

	for (const userId of userIds) {
		await ctx.db.insert(TABLE.NOTIFICATIONS, {
			userId,
			restaurantId: args.restaurantId,
			kind: args.kind,
			messageKey,
			messageParams: args.messageParams,
			href: args.href,
			// Shared across the whole fan-out so the same event sorts together in
			// every recipient's list, rather than by however long the loop took.
			createdAt,
		});
	}

	return userIds.length;
}

/**
 * The same recipients as `notifyRestaurantManagers`, with the address and
 * language to mail them in — so TAVLI-103/102 send their email counterpart to
 * exactly the set that got a bell row, and the two can never drift.
 *
 * Email and language come from the org-level `userRoles` row and
 * `userSettings.language`, the same sources invite mail uses. A manager whose
 * profile carries no email is dropped rather than failing the caller: they
 * cannot be mailed by definition, and they still have the in-app notification.
 */
export async function listRestaurantManagerEmails(
	ctx: NotificationReadCtx,
	restaurantId: Id<"restaurants">
): Promise<RestaurantManagerEmailRecipient[]> {
	const userIds = await collectRestaurantManagerUserIds(ctx, restaurantId);

	const recipients: RestaurantManagerEmailRecipient[] = [];
	for (const userId of userIds) {
		const roleRow = await ctx.db
			.query(TABLE.USER_ROLES)
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();
		const email = roleRow?.email?.trim();
		if (!email) continue;

		const settings = await ctx.db
			.query(TABLE.USER_SETTINGS)
			.withIndex("by_user", (q) => q.eq("userId", userId))
			.first();
		recipients.push({ userId, email, locale: resolveInviteLocale(settings?.language) });
	}

	return recipients;
}
