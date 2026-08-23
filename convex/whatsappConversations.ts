/**
 * The staff-facing read of the WhatsApp assistant's conversations (TAVLI-93).
 *
 * Until now the assistant had no interface at all. Staff could not read what it
 * told a diner, and the first time someone said "but your bot told me…" nobody
 * could check. These three queries are that check, and nothing more: **read
 * only**. There is no send, no takeover, no export.
 *
 * Handover is deliberately out of scope — it needs a staff identity on outbound
 * messages, a way to pause the assistant, and a rule for when it resumes. What
 * this ticket does bring forward is the first of those: every outbound row now
 * records who composed it (`WHATSAPP_MESSAGE_SENDER`), so handover is a code
 * change later rather than a backfill.
 *
 * ## Authorization
 *
 * Any **ACTIVE staff member** of the restaurant — `getCurrentUserId` then
 * `requireRestaurantStaffAccess` — not managers only. The entry point is a link
 * on a reservation, and an employee who can already see that reservation and
 * its phone number but gets a dead link is the worse experience. The view is
 * read-only, so there is nothing here to escalate.
 *
 * ## Scoping
 *
 * A conversation id is a string the client supplies, so it is never treated as
 * evidence of anything. Each read loads the row, takes the restaurant **from
 * the row**, and checks the caller's access against that. A staff member at
 * another restaurant who guesses a valid id gets `NOT_AUTHORIZED`, not a
 * transcript.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundError,
	NotFoundErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { getCurrentUserId, requireRestaurantStaffAccess } from "./_util/auth";
import {
	RESERVATION_SOURCE,
	TABLE,
	WHATSAPP_CONVERSATION_LIST_LIMIT,
	WHATSAPP_CONVERSATION_MAX_MESSAGES,
} from "./constants";
import {
	clampMessageLimit,
	toConversationMessage,
	toConversationSummary,
	type ConversationSummary,
	type ConversationThread,
	type ReservationConversationLinkResult,
} from "./whatsappConversationsHelpers";

type StaffAccessErrors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| NotFoundErrorObject;

/**
 * The caller must be signed in and be active staff at `restaurantId`.
 *
 * `requireRestaurantStaffAccess` admits the platform admin, the restaurant's
 * document owner, an org owner for its organization, and an active manager or
 * employee — which is exactly "anyone who can already open the reservations
 * screen for this restaurant".
 */
async function requireStaffAt(
	ctx: QueryCtx,
	restaurantId: Id<"restaurants">
): AsyncReturn<null, StaffAccessErrors> {
	const [userId, authError] = await getCurrentUserId(ctx);
	if (authError) return [null, authError];
	const [, accessError] = await requireRestaurantStaffAccess(ctx, userId, restaurantId);
	if (accessError) return [null, accessError];
	return [null, null];
}

/**
 * Load a conversation and prove the caller may read it.
 *
 * The restaurant comes off the stored row, never off an argument — that is what
 * makes a guessed id useless.
 */
async function loadReadableConversation(
	ctx: QueryCtx,
	conversationId: Id<"whatsappConversations">
): AsyncReturn<Doc<"whatsappConversations">, StaffAccessErrors> {
	const conversation = await ctx.db.get(conversationId);
	if (!conversation) return [null, new NotFoundError("ERROR_CONVERSATION_NOT_FOUND").toObject()];

	const [, accessError] = await requireStaffAt(ctx, conversation.restaurantId);
	if (accessError) return [null, accessError];

	return [conversation, null];
}

// ============================================================================
// The list
// ============================================================================

/**
 * One restaurant's conversations, most recently active first.
 *
 * Bounded by `WHATSAPP_CONVERSATION_LIST_LIMIT` and read through the
 * `(restaurantId, lastMessageAt)` index, so the read is proportional to what is
 * shown rather than to how long the restaurant has been live. No per-row
 * message lookup: a "last message" preview would be one extra query per
 * conversation, and a few hundred of those is how a screen ends up against
 * Convex's per-function read limit.
 */
export const listForRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async function (ctx, args): AsyncReturn<ConversationSummary[], StaffAccessErrors> {
		const [, accessError] = await requireStaffAt(ctx, args.restaurantId);
		if (accessError) return [null, accessError];

		const rows = await ctx.db
			.query(TABLE.WHATSAPP_CONVERSATIONS)
			.withIndex("by_restaurant_last_message", (q) => q.eq("restaurantId", args.restaurantId))
			.order("desc")
			.take(WHATSAPP_CONVERSATION_LIST_LIMIT);

		return [rows.map(toConversationSummary), null];
	},
});

// ============================================================================
// The thread
// ============================================================================

/**
 * The newest `limit` messages of one thread, oldest-first.
 *
 * "Load older" widens `limit` rather than walking a cursor: the window always
 * ends at the newest message, so a live reply still lands at the bottom while
 * staff are reading, and there is no accumulated client state to get out of
 * step with it. `clampMessageLimit` keeps the read bounded either way.
 *
 * What is returned is `body` — what was actually sent to the diner — never
 * `modelBody`. See `whatsappConversationsHelpers.ts`.
 */
export const getThread = query({
	args: {
		conversationId: v.id(TABLE.WHATSAPP_CONVERSATIONS),
		limit: v.optional(v.number()),
	},
	handler: async function (ctx, args): AsyncReturn<ConversationThread, StaffAccessErrors> {
		const [conversation, accessError] = await loadReadableConversation(ctx, args.conversationId);
		if (accessError) return [null, accessError];

		const limit = clampMessageLimit(args.limit);
		// One extra row is the cheapest way to know whether an older one exists
		// without counting the whole thread.
		const newestFirst = await ctx.db
			.query(TABLE.WHATSAPP_MESSAGES)
			.withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
			.order("desc")
			.take(limit + 1);

		const hasOlder = newestFirst.length > limit;
		const page = newestFirst.slice(0, limit).reverse();

		return [
			{
				conversation: toConversationSummary(conversation),
				messages: page.map(toConversationMessage),
				hasOlder,
				atMaxWindow: limit >= WHATSAPP_CONVERSATION_MAX_MESSAGES,
			},
			null,
		];
	},
});

// ============================================================================
// The reservation → conversation link
// ============================================================================

/**
 * The conversation a reservation came from, or `null`.
 *
 * A reservation stores no conversation id — the bot writes the diner's
 * canonical phone into `contact.phone`, the same form conversations are keyed
 * by (see `toCanonicalE164`), and that phone is the diner's whole identity in
 * this domain (ADR-011). So the link is resolved as
 * `(restaurant, contact.phone)`, restaurant-first, which means it can only ever
 * reach a thread the caller already has access to.
 *
 * Only `source: "whatsapp"` bookings get a link. Those are the ones that need
 * explaining; a booking staff typed in has no thread behind it, and offering a
 * link to whatever thread happens to share the phone would be a different claim
 * than "this is where it came from".
 *
 * Returns `null` rather than an error when there is no thread: a WhatsApp
 * booking whose conversation has since been purged is a missing link, not a
 * failure to render the reservation.
 */
export const getForReservation = query({
	args: { reservationId: v.id(TABLE.RESERVATIONS) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<ReservationConversationLinkResult, StaffAccessErrors> {
		const reservation = await ctx.db.get(args.reservationId);
		if (!reservation) return [null, new NotFoundError("ERROR_RESERVATION_NOT_FOUND").toObject()];

		const [, accessError] = await requireStaffAt(ctx, reservation.restaurantId);
		if (accessError) return [null, accessError];

		if (reservation.source !== RESERVATION_SOURCE.WHATSAPP) return [null, null];

		// Bounded by construction: at most one conversation per channel for a
		// given phone, and a restaurant has a handful of channels.
		const candidates = await ctx.db
			.query(TABLE.WHATSAPP_CONVERSATIONS)
			.withIndex("by_restaurant_customer", (q) =>
				q
					.eq("restaurantId", reservation.restaurantId)
					.eq("customerPhone", reservation.contact.phone)
			)
			.collect();
		if (candidates.length === 0) return [null, null];

		// More than one only happens if the restaurant runs several WhatsApp
		// numbers. The most recently active thread is the one staff mean.
		const newest = candidates.reduce((best, row) =>
			row.lastMessageAt > best.lastMessageAt ? row : best
		);

		return [{ conversationId: newest._id, customerPhone: newest.customerPhone }, null];
	},
});
