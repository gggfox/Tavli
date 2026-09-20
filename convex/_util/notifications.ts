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
 * Three properties are worth naming:
 *
 * 1. **The recipient set mirrors who may read the payments page.** That is
 *    `requireRestaurantManagerOrAbove` minus platform admins: the restaurant's
 *    own `ownerId`, every org-level `owner` of its organization, and every active
 *    `manager` membership. The first two never get a `restaurantMembers` row —
 *    `restaurants.create` seeds none and the backfill in `restaurantMembers.ts`
 *    covers only org managers and employees — and the restaurant owner is
 *    precisely the person who ran Stripe onboarding, i.e. whose bank account
 *    bounced the payout. A membership-only rule would have told everyone except
 *    the one person whose money it is.
 * 2. **Fanned out at event time, not resolved at read time.** The recipient set
 *    is whoever ran the restaurant when the money moved. A manager hired next
 *    week does not inherit last week's failed payout — they were not there, it is
 *    not theirs to act on, and a join-at-read-time list would hand them every
 *    historical problem on their first login.
 * 3. **Employee accounts get nothing.** A `RestaurantMember` backed by an
 *    `EmployeeAccount` (ADR 006) has no Clerk identity — no `userId`, no inbox,
 *    no session that could open the bell. Its holder signs in through the
 *    restaurant's shared employee session with a Personal PIN, a surface that
 *    exists for clocking in and reading one's own tips. Writing a row for one
 *    would be a row nobody can ever read. They are also the wrong audience:
 *    a dispute is the restaurant's money, and a server can neither see the
 *    payments page nor act on a chargeback.
 *
 * Platform admins are deliberately outside the set: they hear about the same
 * events through `raiseOperatorAlert` (TAVLI-109), and a restaurant's bell is not
 * where Tavli's own incident traffic belongs.
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
	USER_ROLES,
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
	/**
	 * Caller-chosen identity for "this same news". While a recipient has an
	 * **unread** notification with this key, notifying them again is a no-op.
	 *
	 * **Any caller driven by a Stripe event MUST pass one, naming the Stripe
	 * object** — `payout_failed:${payoutId}`, `dispute_opened:${disputeId}`.
	 * Stripe redelivers, and webhook handlers get retried: without a key a single
	 * failed payout becomes one bell row per delivery, which is how a manager
	 * learns to ignore the bell. Scoped to unread rows only, so once they have
	 * read it, a genuine recurrence reaches them again.
	 */
	dedupeKey?: string;
};

/** One recipient of the email counterpart, and the language they read in. */
export type RestaurantManagerEmailRecipient = {
	userId: string;
	email: string;
	locale: InviteEmailLocale;
};

/** Reads only, so a query can ask "who are this restaurant's managers?" too. */
type NotificationReadCtx = QueryCtx | MutationCtx;

const RECIPIENT_MEMBER_ROLES = new Set<string>(NOTIFICATION_RECIPIENT_MEMBER_ROLES);

/**
 * Clerk subjects of everyone who is manager-or-above for this restaurant,
 * de-duplicated and in a stable order: the restaurant's own owner first, then the
 * organization's owners, then active manager memberships.
 *
 * The three sources are the same three `requireRestaurantManagerOrAbove` accepts
 * (see the module comment for why a membership-only rule was wrong). Platform
 * admins are the one branch of that gate deliberately left out.
 *
 * Indexed throughout — `by_organizationId` on `userRoles`, `by_restaurant` on
 * `restaurantMembers`. The member role and the ADR-006 XOR half are filtered in
 * memory because a restaurant has tens of members, not thousands, and an index
 * per predicate on a table that size buys nothing.
 *
 * A membership without `userId` is `EmployeeAccount`-backed and is skipped.
 * `isActive` is required because a removed manager keeps their row — `removedAt`
 * set, `isActive` flipped — and a former manager should stop hearing about the
 * restaurant's money the moment they are removed.
 */
async function collectRecipientUserIds(
	ctx: NotificationReadCtx,
	restaurantId: Id<"restaurants">
): Promise<string[]> {
	const restaurant = await ctx.db.get(restaurantId);
	if (!restaurant) return [];

	const userIds: string[] = [];
	const seen = new Set<string>();
	const add = (userId: string | undefined) => {
		if (!userId || seen.has(userId)) return;
		seen.add(userId);
		userIds.push(userId);
	};

	// The primary account on the restaurant row: its creator, its billing owner,
	// and whoever completed Stripe Connect onboarding for it.
	add(restaurant.ownerId);

	// Org-level owners of this restaurant's organization. `owner` here is the
	// CLIENT role — a restaurant group's proprietor — not a Tavli operator.
	const orgRoleRows: Doc<"userRoles">[] = await ctx.db
		.query(TABLE.USER_ROLES)
		.withIndex("by_organizationId", (q) => q.eq("organizationId", restaurant.organizationId))
		.collect();
	for (const row of orgRoleRows) {
		if (!(row.roles ?? []).includes(USER_ROLES.OWNER)) continue;
		add(row.userId);
	}

	const members: Doc<"restaurantMembers">[] = await ctx.db
		.query(TABLE.RESTAURANT_MEMBERS)
		.withIndex("by_restaurant", (q) => q.eq("restaurantId", restaurantId))
		.collect();
	for (const member of members) {
		if (!member.isActive) continue;
		if (!RECIPIENT_MEMBER_ROLES.has(member.role)) continue;
		// Employee-account-backed membership: no Clerk identity, nothing to notify.
		add(member.userId);
	}

	return userIds;
}

/**
 * Write one notification per manager-or-above of `restaurantId`, and return how
 * many were written.
 *
 * With a `dedupeKey`, a recipient who already has an unread notification under
 * that key is skipped — so a replayed Stripe webhook returns 0 rather than
 * doubling everyone's bell. The return value is therefore "notifications
 * delivered", not "people who could have received one".
 *
 * Takes a `MutationCtx` rather than being a Convex function so a webhook handler
 * already mid-transaction can notify without a `runMutation` round trip — the
 * same shape as `raiseOperatorAlert`. Actions reach it through
 * `internal.notifications.notifyRestaurantManagersInternal`.
 *
 * Returns 0 for a restaurant with nobody eligible, which is a real state and not
 * an error: the caller's own operator alert is what makes sure a human at Tavli
 * still sees the problem.
 */
export async function notifyRestaurantManagers(
	ctx: MutationCtx,
	args: NotifyRestaurantManagersArgs
): Promise<number> {
	const userIds = await collectRecipientUserIds(ctx, args.restaurantId);
	const createdAt = Date.now();
	const messageKey = args.messageKey ?? NOTIFICATION_BODY_KEY[args.kind];

	let written = 0;
	for (const userId of userIds) {
		if (args.dedupeKey) {
			// Indexed probe, not a scan of the person's history: `by_user_dedupe_read`
			// is prefixed on all three, and an absent `readAt` is what "unread" means.
			const existing = await ctx.db
				.query(TABLE.NOTIFICATIONS)
				.withIndex("by_user_dedupe_read", (q) =>
					q.eq("userId", userId).eq("dedupeKey", args.dedupeKey).eq("readAt", undefined)
				)
				.first();
			// Deliberately nothing else: no touched timestamp, no counter. This
			// person already has it on their screen, unread.
			if (existing) continue;
		}

		await ctx.db.insert(TABLE.NOTIFICATIONS, {
			userId,
			restaurantId: args.restaurantId,
			kind: args.kind,
			messageKey,
			messageParams: args.messageParams,
			href: args.href,
			dedupeKey: args.dedupeKey,
			// Shared across the whole fan-out so the same event sorts together in
			// every recipient's list, rather than by however long the loop took.
			createdAt,
		});
		written++;
	}

	return written;
}

/**
 * The same recipients as `notifyRestaurantManagers`, with the address and
 * language to mail them in — so TAVLI-103/102 send their email counterpart to
 * exactly the set that got a bell row, and the two can never drift.
 *
 * Email and language come from the org-level `userRoles` row and
 * `userSettings.language`, the same sources invite mail uses. A recipient whose
 * profile carries no email is dropped rather than failing the caller: they cannot
 * be mailed by definition, and they still have the in-app notification.
 */
export async function listRestaurantManagerEmails(
	ctx: NotificationReadCtx,
	restaurantId: Id<"restaurants">
): Promise<RestaurantManagerEmailRecipient[]> {
	const userIds = await collectRecipientUserIds(ctx, restaurantId);

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
