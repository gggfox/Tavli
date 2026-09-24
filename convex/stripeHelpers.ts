import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import {
	AUDIT_SYSTEM_USER_ID,
	ORDER_PAYMENT_STATE,
	ORDER_STATUS,
	PAYMENT_KIND,
	PAYMENT_REFUND_STATUS,
	PAYMENT_STATUS,
	STRIPE_ACCOUNT_STATUS,
	TABLE,
} from "./constants";
import { ConflictError, fromErrorObject } from "./_shared/errors";
import { appendAuditEvent } from "./_util/audit";
import { restoreLedgerForRefund } from "./disputes";
import { mergeRefundTotals } from "./orderRefundHelpers";
import { isPaymentCreateInFlight, PAYMENT_SUPERSEDE_ERRORS } from "./paymentSupersedeHelpers";

const paymentStatusValidator = v.union(
	v.literal(PAYMENT_STATUS.PENDING),
	v.literal(PAYMENT_STATUS.PROCESSING),
	v.literal(PAYMENT_STATUS.SUCCEEDED),
	v.literal(PAYMENT_STATUS.FAILED),
	v.literal(PAYMENT_STATUS.SUPERSEDED),
	v.literal(PAYMENT_STATUS.CANCELLED)
);

const paymentRefundStatusValidator = v.union(
	v.literal(PAYMENT_REFUND_STATUS.NONE),
	v.literal(PAYMENT_REFUND_STATUS.REQUESTED),
	v.literal(PAYMENT_REFUND_STATUS.SUCCEEDED),
	v.literal(PAYMENT_REFUND_STATUS.PARTIAL),
	v.literal(PAYMENT_REFUND_STATUS.FAILED)
);

const stripeAccountStatusValidator = v.union(
	v.literal(STRIPE_ACCOUNT_STATUS.ACTIVE),
	v.literal(STRIPE_ACCOUNT_STATUS.RESTRICTED),
	v.literal(STRIPE_ACCOUNT_STATUS.CLOSED)
);

const paymentKindValidator = v.union(v.literal(PAYMENT_KIND.ORDER), v.literal(PAYMENT_KIND.TIP));

const orderPaymentStateValidator = v.union(
	v.literal(ORDER_PAYMENT_STATE.UNPAID),
	v.literal(ORDER_PAYMENT_STATE.PENDING),
	v.literal(ORDER_PAYMENT_STATE.PROCESSING),
	v.literal(ORDER_PAYMENT_STATE.PAID),
	v.literal(ORDER_PAYMENT_STATE.FAILED),
	v.literal(ORDER_PAYMENT_STATE.REFUND_REQUESTED),
	v.literal(ORDER_PAYMENT_STATE.REFUNDED),
	v.literal(ORDER_PAYMENT_STATE.REFUND_FAILED)
);

// =============================================================================
// Internal Queries
// =============================================================================
// Used by stripe.ts actions via ctx.runQuery(internal.stripeHelpers.*)

export const getRestaurantInternal = internalQuery({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.restaurantId);
	},
});

export const getUserRoleInternal = internalQuery({
	args: { userId: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query(TABLE.USER_ROLES)
			.withIndex("by_user", (q) => q.eq("userId", args.userId))
			.first();
	},
});

export const getRestaurantByStripeAccountIdInternal = internalQuery({
	args: { stripeAccountId: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_stripe_account", (q) => q.eq("stripeAccountId", args.stripeAccountId))
			.first();
	},
});

export const getOrderInternal = internalQuery({
	args: { orderId: v.id(TABLE.ORDERS) },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.orderId);
	},
});

export const getOrderItemInternal = internalQuery({
	args: { orderItemId: v.id(TABLE.ORDER_ITEMS) },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.orderItemId);
	},
});

export const getPaymentInternal = internalQuery({
	args: { paymentId: v.id(TABLE.PAYMENTS) },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.paymentId);
	},
});

export const getPaymentByPaymentIntentIdInternal = internalQuery({
	args: { stripePaymentIntentId: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query(TABLE.PAYMENTS)
			.withIndex("by_payment_intent", (q) =>
				q.eq("stripePaymentIntentId", args.stripePaymentIntentId)
			)
			.first();
	},
});

/**
 * Resolves the `paymentId` / `restaurantId` a PaymentIntent carries in its
 * metadata into real documents (TAVLI-105).
 *
 * Every intent Tavli creates stamps both — `createOrderPaymentIntent`,
 * `createTabPaymentIntent` and `createTipCharge` alike — which is what lets the
 * webhook find a payment row whose `stripePaymentIntentId` has not landed yet.
 *
 * Takes plain strings, not `v.id(...)`, and goes through `normalizeId`. That is
 * the whole point: metadata is arbitrary text off the wire, and handing a
 * `v.id(TABLE.PAYMENTS)` validator a string that is not an id of that table
 * THROWS. A throw inside `fulfillPayment` means a non-2xx, which means Stripe
 * redelivers the same event for days and throws again every time. A value that
 * does not normalize is simply not one of our rows, and the caller treats it as
 * such.
 *
 * The restaurant is resolved rather than passed through so an operator alert
 * can never be filed against an id that names nothing.
 */
export const resolveStripeMetadataRefsInternal = internalQuery({
	args: {
		paymentId: v.optional(v.string()),
		restaurantId: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const paymentId = args.paymentId ? ctx.db.normalizeId(TABLE.PAYMENTS, args.paymentId) : null;
		const restaurantId = args.restaurantId
			? ctx.db.normalizeId(TABLE.RESTAURANTS, args.restaurantId)
			: null;

		const restaurant = restaurantId ? await ctx.db.get(restaurantId) : null;
		return {
			payment: paymentId ? await ctx.db.get(paymentId) : null,
			restaurantId: restaurant?._id ?? null,
		};
	},
});

export const listPaymentsByOrderInternal = internalQuery({
	args: { orderId: v.id(TABLE.ORDERS) },
	handler: async (ctx, args) => {
		const payments = await ctx.db
			.query(TABLE.PAYMENTS)
			.withIndex("by_order", (q) => q.eq("orderId", args.orderId))
			.collect();

		return payments.sort((a, b) => {
			if (a.attemptNumber !== b.attemptNumber) {
				return b.attemptNumber - a.attemptNumber;
			}
			return b.createdAt - a.createdAt;
		});
	},
});

export const getLatestPaymentByOrderInternal = internalQuery({
	args: { orderId: v.id(TABLE.ORDERS) },
	handler: async (ctx, args) => {
		const payments = await ctx.db
			.query(TABLE.PAYMENTS)
			.withIndex("by_order", (q) => q.eq("orderId", args.orderId))
			.collect();

		return (
			payments
				.sort((a, b) => {
					if (a.attemptNumber !== b.attemptNumber) {
						return b.attemptNumber - a.attemptNumber;
					}
					return b.createdAt - a.createdAt;
				})
				.at(0) ?? null
		);
	},
});

export const getProcessedStripeWebhookEventInternal = internalQuery({
	args: { eventId: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query(TABLE.STRIPE_WEBHOOK_EVENTS)
			.withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
			.first();
	},
});

// =============================================================================
// Internal Mutations
// =============================================================================

export const saveStripeAccountId = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		stripeAccountId: v.string(),
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.restaurantId, {
			stripeAccountId: args.stripeAccountId,
			// A brand-new account id starts with no status of its own. Clearing it
			// is what lets a restaurant whose previous account Stripe CLOSED
			// onboard again — `closed` is terminal per account id, not per
			// restaurant, and the next status refresh writes the new one's.
			stripeAccountStatus: undefined,
			updatedAt: Date.now(),
		});
	},
});

export const updateOnboardingStatus = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		stripeOnboardingComplete: v.boolean(),
		stripeAccountStatus: v.optional(stripeAccountStatusValidator),
	},
	handler: async (ctx, args) => {
		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) return;
		if (isClosedAndStaysClosed(restaurant.stripeAccountStatus, args.stripeAccountStatus)) return;

		await ctx.db.patch(args.restaurantId, {
			stripeOnboardingComplete: args.stripeOnboardingComplete,
			...(args.stripeAccountStatus !== undefined && {
				stripeAccountStatus: args.stripeAccountStatus,
			}),
			updatedAt: Date.now(),
		});
	},
});

/**
 * Unlinks a restaurant from its Stripe connected account by clearing
 * `stripeAccountId` and `stripeOnboardingComplete`. Used by the Reset Stripe
 * Setup flow so a new account (e.g. with a different country) can be created.
 * The Stripe account itself is closed separately in the action layer.
 */
export const clearStripeConnection = internalMutation({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		await ctx.db.patch(args.restaurantId, {
			stripeAccountId: undefined,
			stripeOnboardingComplete: undefined,
			// The admin Reset is the documented way out of a `closed` account, so
			// the status has to go with the link it described.
			stripeAccountStatus: undefined,
			updatedAt: Date.now(),
		});
	},
});

/**
 * Whether a status write must be dropped because the account is already closed.
 *
 * Stripe does not reopen a closed account, but it does keep delivering
 * `v2.core.account[...]` events about one, and `getAccountStatus` keeps being
 * called from the admin page. Without this guard any of those could patch
 * `stripeOnboardingComplete: true` back onto a dead account and re-open the
 * payment gates. Only an explicit `closed` write (the closure handler itself,
 * replayed) gets through; leaving the state is the admin Reset's job, or
 * `saveStripeAccountId` with a new account id.
 */
function isClosedAndStaysClosed(
	current: string | undefined,
	incoming: string | undefined
): boolean {
	return current === STRIPE_ACCOUNT_STATUS.CLOSED && incoming !== STRIPE_ACCOUNT_STATUS.CLOSED;
}

/**
 * Updates onboarding status by looking up the restaurant via its Stripe account ID.
 * Used by webhook handlers that only know the Stripe account ID, not our internal ID.
 */
export const updateOnboardingByAccountId = internalMutation({
	args: {
		stripeAccountId: v.string(),
		stripeOnboardingComplete: v.boolean(),
		stripeAccountStatus: v.optional(stripeAccountStatusValidator),
	},
	handler: async (ctx, args) => {
		const restaurant = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_stripe_account", (q) => q.eq("stripeAccountId", args.stripeAccountId))
			.first();
		if (!restaurant) return;
		if (isClosedAndStaysClosed(restaurant.stripeAccountStatus, args.stripeAccountStatus)) return;

		await ctx.db.patch(restaurant._id, {
			stripeOnboardingComplete: args.stripeOnboardingComplete,
			...(args.stripeAccountStatus !== undefined && {
				stripeAccountStatus: args.stripeAccountStatus,
			}),
			updatedAt: Date.now(),
		});
	},
});

/**
 * Records that Stripe closed (or rejected) a connected account — TAVLI-65.
 *
 * Three things happen together, which is why this is one mutation rather than
 * a `updateOnboardingByAccountId` call with different arguments:
 *
 * 1. `stripeOnboardingComplete: false` shuts the payment gates that read it.
 * 2. `stripeAccountStatus: "closed"` is the only record that distinguishes a
 *    closed account from a restaurant that never had one, and it is what the
 *    admin page and the gates' error message both key off.
 * 3. `stripeAccountId` is **kept**. The operator's next step is to look the
 *    account up in the Stripe Dashboard, and an unlink here would throw away
 *    the only handle on it. (The admin Reset does unlink — deliberately, as the
 *    prelude to onboarding a replacement.)
 *
 * Returns the restaurant, so the caller can attach it to the operator alert
 * without a second round trip. `null` means no restaurant in this deployment
 * claims that account id — dev and staging share one Stripe test account, so a
 * closure fired by another environment lands here too.
 */
export const markStripeAccountClosedByAccountId = internalMutation({
	args: { stripeAccountId: v.string() },
	handler: async (ctx, args): Promise<{ restaurantId: Id<"restaurants"> } | null> => {
		const restaurant = await ctx.db
			.query(TABLE.RESTAURANTS)
			.withIndex("by_stripe_account", (q) => q.eq("stripeAccountId", args.stripeAccountId))
			.first();
		if (!restaurant) return null;

		await ctx.db.patch(restaurant._id, {
			stripeOnboardingComplete: false,
			stripeAccountStatus: STRIPE_ACCOUNT_STATUS.CLOSED,
			updatedAt: Date.now(),
		});
		return { restaurantId: restaurant._id };
	},
});

export const savePaymentIntentId = internalMutation({
	args: {
		orderId: v.id(TABLE.ORDERS),
		stripePaymentIntentId: v.string(),
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.orderId, {
			stripePaymentIntentId: args.stripePaymentIntentId,
			updatedAt: Date.now(),
		});
	},
});

export const createPayment = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		/** Absent on kind "tip" rows, which are session-scoped (`sessionId` only). */
		orderId: v.optional(v.id(TABLE.ORDERS)),
		/** Set on kind "tip" rows (the visit grouping); order rows carry `orderId` only. */
		sessionId: v.optional(v.id(TABLE.SESSIONS)),
		amount: v.number(),
		// ADR 008 breakdown: new-model rows satisfy amount === subtotalAmount +
		// feeAmount. Absent on legacy rows. Tip rows carry subtotal 0 / fee 0 and
		// the whole amount in `gratuityAmount`.
		subtotalAmount: v.optional(v.number()),
		feeAmount: v.optional(v.number()),
		/** Tip portion in smallest currency unit (kind "tip": equals `amount`). */
		gratuityAmount: v.optional(v.number()),
		kind: v.optional(paymentKindValidator),
		paidByUserId: v.optional(v.string()),
		currency: v.string(),
		status: paymentStatusValidator,
		refundStatus: paymentRefundStatusValidator,
		attemptNumber: v.number(),
		orderUpdatedAtSnapshot: v.optional(v.number()),
		stripePaymentIntentId: v.optional(v.string()),
		stripeChargeId: v.optional(v.string()),
		stripeRefundId: v.optional(v.string()),
		latestStripeEventId: v.optional(v.string()),
		failureCode: v.optional(v.string()),
		failureMessage: v.optional(v.string()),
		succeededAt: v.optional(v.number()),
		failedAt: v.optional(v.number()),
		refundRequestedAt: v.optional(v.number()),
		refundedAt: v.optional(v.number()),
		/**
		 * Dispute recovery withheld from this payment's transfer (TAVLI-102).
		 * Set by `createPaymentIntent` on ORDER rows only; the ledger itself is
		 * drawn down later, when the charge settles.
		 */
		disputeRecoveryAmount: v.optional(v.number()),
		disputeRecoveryIds: v.optional(v.array(v.id(TABLE.DISPUTE_RECOVERIES))),
		/**
		 * The attempt the calling action stood down at Stripe and retired before
		 * asking for this row (TAVLI-104). Omitted when it saw no live attempt.
		 * Re-checked inside this transaction — see the handler.
		 */
		supersededPaymentId: v.optional(v.id(TABLE.PAYMENTS)),
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		const { supersededPaymentId, ...row } = args;

		// TRANSACTIONAL "is this order still the one we priced?" guard.
		//
		// `createPaymentIntent` read the order seconds ago and priced the charge
		// from that snapshot. In between, staff can tap "mark paid in person"
		// (`orders.markOrderPaidInPerson` only refuses while a LIVE card attempt
		// exists — and until this insert there is none), or another member can
		// edit the shared draft. Without re-asking here, the row goes in, the
		// diner's card is charged, and `confirmPayment` accepts it over the cash
		// settlement — or charges a total nobody is looking at any more.
		//
		// Thrown BEFORE anything is written and before the action reaches
		// Stripe, so there is no intent to clean up and the order is untouched.
		if (row.orderId) {
			assertOrderStillPayable(await ctx.db.get(row.orderId), row.orderUpdatedAtSnapshot);
		}

		// TRANSACTIONAL double-tap guard (TAVLI-104 review round 1).
		//
		// The action already stood the previous attempt down at Stripe and
		// refused to proceed if it was still in flight — but it did that against
		// a snapshot it read seconds earlier. Two members tapping Pay 300ms apart
		// both read "no live attempt", both stand nothing down, and both insert.
		// The question has to be asked again HERE, inside the transaction that
		// does the inserting, where Convex's OCC can serialise the answer: the
		// lookup reads the order document (or the session's payment rows), and
		// the loser's own write to that same document makes one of the two
		// transactions retry and see the other's row.
		//
		// `supersededPaymentId` is what the action believed the live attempt was
		// and has already retired. Anything else live means somebody else got
		// here first.
		const live = await findLiveAttempt(ctx, row);
		if (live && (live._id !== supersededPaymentId || isPaymentCreateInFlight(live, now))) {
			throw fromErrorObject(new ConflictError(PAYMENT_SUPERSEDE_ERRORS.IN_PROGRESS).toObject());
		}

		const paymentId = await ctx.db.insert(TABLE.PAYMENTS, {
			...row,
			createdAt: now,
			updatedAt: now,
		});

		// The order's pointer moves in the SAME transaction as the insert, not in
		// a follow-up call from the action. That is what gives the guard above
		// something to collide on: two concurrent taps both read and write this
		// document, so OCC has to order them, and the second one re-runs and
		// finds the first one's row.
		if (row.orderId) {
			const order = await ctx.db.get(row.orderId);
			if (order) {
				await ctx.db.patch(row.orderId, {
					paymentState: ORDER_PAYMENT_STATE.PENDING,
					activePaymentId: paymentId,
					updatedAt: order.updatedAt,
				});
			}
		}

		return paymentId;
	},
});

/**
 * The order states a diner may still start a card charge from — the same pair
 * `createPaymentIntent` and `orders.verifyOrderForPaymentInternal` accept.
 */
const CARD_PAYABLE_ORDER_STATUSES: ReadonlySet<string> = new Set([
	ORDER_STATUS.DRAFT,
	ORDER_STATUS.AWAITING_PAYMENT,
]);

/** Settled one way or another: nothing is left for a card to pay. */
const SETTLED_ORDER_PAYMENT_STATES: ReadonlySet<string> = new Set([
	ORDER_PAYMENT_STATE.PAID,
	ORDER_PAYMENT_STATE.REFUND_REQUESTED,
	ORDER_PAYMENT_STATE.REFUNDED,
	ORDER_PAYMENT_STATE.REFUND_FAILED,
]);

/**
 * Throws a stable code unless `order` is still exactly the one the calling
 * action priced: it exists, is in a card-payable status, is not already
 * settled, and has not been edited since `orderUpdatedAtSnapshot`.
 *
 * `updatedAt` is the edit marker because every order edit bumps it, while the
 * payment-bookkeeping writes (`createPayment` itself, `updateOrderPaymentSummary`)
 * deliberately keep it — which is what lets a re-tap on an unedited order
 * pass. A caller that sends no snapshot skips only that last comparison;
 * `createPaymentIntent`, the one production caller, always sends it.
 */
function assertOrderStillPayable(
	order: Doc<"orders"> | null,
	orderUpdatedAtSnapshot: number | undefined
): void {
	if (order?.paymentState && SETTLED_ORDER_PAYMENT_STATES.has(order.paymentState)) {
		// Paid in person (or by an earlier charge) since the snapshot. Same
		// message the supersede path uses: there is nothing left to pay.
		throw fromErrorObject(new ConflictError(PAYMENT_SUPERSEDE_ERRORS.ALREADY_PAID).toObject());
	}
	if (
		!order ||
		!CARD_PAYABLE_ORDER_STATUSES.has(order.status) ||
		(orderUpdatedAtSnapshot !== undefined && order.updatedAt !== orderUpdatedAtSnapshot)
	) {
		throw fromErrorObject(new ConflictError(PAYMENT_SUPERSEDE_ERRORS.ORDER_CHANGED).toObject());
	}
}

/**
 * The live payment attempt for whatever this new row is about to pay for, or
 * `null`. "Live" is `pending` or `processing` — a terminal row cannot be
 * charged and does not block anything.
 *
 * Two scopes, because the two kinds of row are grouped differently (ADR 008):
 * an order row is the one the ORDER points at, while a tip row is per member
 * per visit and has no pointer to read, so it is found the same way
 * `payments.getActiveTipPaymentInternal` finds it.
 */
async function findLiveAttempt(
	ctx: MutationCtx,
	row: { orderId?: Id<"orders">; sessionId?: Id<"sessions">; kind?: string; paidByUserId?: string }
): Promise<Doc<"payments"> | null> {
	const isLive = (payment: Doc<"payments">) =>
		payment.status === PAYMENT_STATUS.PENDING || payment.status === PAYMENT_STATUS.PROCESSING;

	if (row.orderId) {
		const order = await ctx.db.get(row.orderId);
		if (!order?.activePaymentId) return null;
		const active = await ctx.db.get(order.activePaymentId);
		return active && isLive(active) ? active : null;
	}

	if (row.kind === PAYMENT_KIND.TIP && row.sessionId && row.paidByUserId) {
		const sessionPayments = await ctx.db
			.query(TABLE.PAYMENTS)
			.withIndex("by_session", (q) => q.eq("sessionId", row.sessionId))
			.collect();
		let latest: Doc<"payments"> | null = null;
		for (const payment of sessionPayments) {
			if (payment.kind !== PAYMENT_KIND.TIP) continue;
			if (payment.paidByUserId !== row.paidByUserId) continue;
			if (!isLive(payment)) continue;
			if (!latest || payment.createdAt > latest.createdAt) latest = payment;
		}
		return latest;
	}

	return null;
}

/**
 * Records the PaymentIntent a payment row was charged on, WITHOUT ever moving
 * the row backwards (TAVLI-105).
 *
 * This is the create-path half of the same race the webhook's metadata fallback
 * fixes, and it is the more dangerous half. `createTipCharge` charges the saved
 * card with `off_session: true, confirm: true`, so by the time
 * `paymentIntents.create` returns, `payment_intent.succeeded` may already have
 * been delivered and — now that the fallback can find the row without an intent
 * id — may already have SETTLED it. The blind
 * `updatePayment({ status: "processing", stripePaymentIntentId })` that used to
 * run here would then overwrite `succeeded` with `processing`, permanently: the
 * tip is uncredited, Stripe's redeliveries are already deduped, and the diner's
 * retry is refused because an in-flight attempt exists. Fixing the webhook
 * without fixing this would have moved the bug rather than closed it.
 *
 * So the status only ever moves PENDING → PROCESSING. A row that has reached
 * `succeeded`, `failed`, `superseded` or `cancelled` keeps that status and only
 * gains the ids, which are facts about the charge and safe to record either way.
 *
 * A row already naming a DIFFERENT intent is not touched at all: two intents
 * cannot both be the one that charged it, and the webhook is the half that knows
 * which. Logged rather than thrown — this runs after the money has moved, and
 * throwing would show the diner an error for a charge that went through.
 */
export const attachIntentToPayment = internalMutation({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		stripePaymentIntentId: v.string(),
		/** The saved card, on the one-tap path. */
		stripePaymentMethodId: v.optional(v.string()),
	},
	/**
	 * `attached: false` means this intent is NOT the row's intent — the row is
	 * gone, holds another one, or was retired. The caller must not go on to hand
	 * its client secret to the diner or re-point the order at it (sign-off nit).
	 */
	returns: v.object({ attached: v.boolean() }),
	handler: async (ctx, args): Promise<{ attached: boolean }> => {
		const payment = await ctx.db.get(args.paymentId);
		if (!payment) return { attached: false };

		if (
			payment.stripePaymentIntentId &&
			payment.stripePaymentIntentId !== args.stripePaymentIntentId
		) {
			console.error("[stripeHelpers.attachIntentToPayment] INTENT ID CONFLICT", {
				paymentId: payment._id,
				paymentKind: payment.kind ?? "legacy",
				status: payment.status,
			});
			return { attached: false };
		}

		// A RETIRED row does not get the intent id at all (TAVLI-104 review round
		// 1). This is the late return: the row was superseded or cancelled while
		// its own `paymentIntents.create` was still running, and the call has now
		// come back with an intent nobody is waiting for. Writing the id onto the
		// row would hand the webhook's metadata fallback a target — and
		// `confirmTipPayment` settles anything that is not already SUCCEEDED, so
		// the retired attempt would be credited alongside the one that replaced
		// it. That is the double tip, arriving by the back door.
		//
		// Instead the intent is stood down at Stripe by id. If it is unconfirmed
		// it dies there and no money ever moves; if it already charged, the
		// stand-down raises a severe alert, because that is money a human has to
		// decide about. The row keeps its retired status either way.
		if (
			payment.status === PAYMENT_STATUS.SUPERSEDED ||
			payment.status === PAYMENT_STATUS.CANCELLED
		) {
			console.error("[stripeHelpers.attachIntentToPayment] INTENT ARRIVED FOR A RETIRED ROW", {
				paymentId: payment._id,
				paymentKind: payment.kind ?? "legacy",
				status: payment.status,
			});
			await ctx.scheduler.runAfter(0, internal.stripe.standDownSupersededIntent, {
				paymentId: payment._id,
				stripePaymentIntentId: args.stripePaymentIntentId,
			});
			return { attached: false };
		}

		await ctx.db.patch(args.paymentId, {
			stripePaymentIntentId: args.stripePaymentIntentId,
			...(args.stripePaymentMethodId !== undefined && {
				stripePaymentMethodId: args.stripePaymentMethodId,
			}),
			// Forward only. Anything past PENDING has already been decided, by the
			// webhook or by a superseding attempt, and that decision stands.
			...(payment.status === PAYMENT_STATUS.PENDING && { status: PAYMENT_STATUS.PROCESSING }),
			updatedAt: Date.now(),
		});
		return { attached: true };
	},
});

/**
 * Records a create-path failure WITHOUT ever undoing a settlement (TAVLI-105,
 * review round 2). The failure twin of {@link attachIntentToPayment}.
 *
 * The scenario this closes is the ugliest version of the off-session race.
 * `createTipCharge` calls `paymentIntents.create` with `confirm: true`; Stripe
 * charges the card and then the RESPONSE is lost — a timeout on the call and on
 * both `maxNetworkRetries` replays. The money has moved, Stripe delivers
 * `payment_intent.succeeded`, and the webhook settles the tip through the
 * metadata fallback. Only then does the action's `catch` run, and a blind
 * `updatePayment({ status: "failed" })` would take a SUCCEEDED row to FAILED:
 * the credit gone, the event already deduped so no redelivery can restore it,
 * and — because the action rethrows — the diner told to try again, which is a
 * second charge for the same tip.
 *
 * So FAILED is written only from PENDING or PROCESSING. SUCCEEDED is reported
 * back instead of overwritten, and callers on the racy path return success
 * rather than rethrowing. SUPERSEDED and CANCELLED are left alone too: a
 * superseding attempt owns the row by then, and resurrecting it as "the failed
 * attempt" would confuse the retry logic that superseded it.
 */
export const failPaymentUnlessSettled = internalMutation({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		failureCode: v.optional(v.string()),
		failureMessage: v.optional(v.string()),
	},
	returns: v.object({ alreadySucceeded: v.boolean() }),
	handler: async (ctx, args): Promise<{ alreadySucceeded: boolean }> => {
		const payment = await ctx.db.get(args.paymentId);
		if (!payment) return { alreadySucceeded: false };

		// The charge went through and something else already recorded it. The
		// caller needs to know, because "throw" and "return success" are very
		// different things to show a diner who has been charged.
		if (payment.status === PAYMENT_STATUS.SUCCEEDED) return { alreadySucceeded: true };

		if (payment.status !== PAYMENT_STATUS.PENDING && payment.status !== PAYMENT_STATUS.PROCESSING) {
			return { alreadySucceeded: false };
		}

		const now = Date.now();
		await ctx.db.patch(args.paymentId, {
			status: PAYMENT_STATUS.FAILED,
			...(args.failureCode !== undefined && { failureCode: args.failureCode }),
			...(args.failureMessage !== undefined && { failureMessage: args.failureMessage }),
			failedAt: now,
			updatedAt: now,
		});
		return { alreadySucceeded: false };
	},
});

export const updatePayment = internalMutation({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		status: v.optional(paymentStatusValidator),
		refundStatus: v.optional(paymentRefundStatusValidator),
		/** Saved card persisted on success for later one-tap charges (ADR 008). */
		stripePaymentMethodId: v.optional(v.string()),
		stripePaymentIntentId: v.optional(v.string()),
		stripeChargeId: v.optional(v.string()),
		stripeRefundId: v.optional(v.string()),
		latestStripeEventId: v.optional(v.string()),
		failureCode: v.optional(v.string()),
		failureMessage: v.optional(v.string()),
		succeededAt: v.optional(v.number()),
		failedAt: v.optional(v.number()),
		refundRequestedAt: v.optional(v.number()),
		refundedAt: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const payment = await ctx.db.get(args.paymentId);
		if (!payment) return;

		await ctx.db.patch(args.paymentId, {
			...(args.status !== undefined && { status: args.status }),
			...(args.refundStatus !== undefined && { refundStatus: args.refundStatus }),
			...(args.stripePaymentMethodId !== undefined && {
				stripePaymentMethodId: args.stripePaymentMethodId,
			}),
			...(args.stripePaymentIntentId !== undefined && {
				stripePaymentIntentId: args.stripePaymentIntentId,
			}),
			...(args.stripeChargeId !== undefined && { stripeChargeId: args.stripeChargeId }),
			...(args.stripeRefundId !== undefined && { stripeRefundId: args.stripeRefundId }),
			...(args.latestStripeEventId !== undefined && {
				latestStripeEventId: args.latestStripeEventId,
			}),
			...(args.failureCode !== undefined && { failureCode: args.failureCode }),
			...(args.failureMessage !== undefined && { failureMessage: args.failureMessage }),
			...(args.succeededAt !== undefined && { succeededAt: args.succeededAt }),
			...(args.failedAt !== undefined && { failedAt: args.failedAt }),
			...(args.refundRequestedAt !== undefined && {
				refundRequestedAt: args.refundRequestedAt,
			}),
			...(args.refundedAt !== undefined && { refundedAt: args.refundedAt }),
			updatedAt: Date.now(),
		});
	},
});

export const updateOrderPaymentSummary = internalMutation({
	args: {
		orderId: v.id(TABLE.ORDERS),
		paymentState: v.optional(orderPaymentStateValidator),
		activePaymentId: v.optional(v.id(TABLE.PAYMENTS)),
		stripePaymentIntentId: v.optional(v.string()),
		paidAt: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.orderId, {
			...(args.paymentState !== undefined && { paymentState: args.paymentState }),
			...(args.activePaymentId !== undefined && { activePaymentId: args.activePaymentId }),
			...(args.stripePaymentIntentId !== undefined && {
				stripePaymentIntentId: args.stripePaymentIntentId,
			}),
			...(args.paidAt !== undefined && { paidAt: args.paidAt }),
		});
	},
});

export const recordStripeWebhookEvent = internalMutation({
	args: {
		eventId: v.string(),
		eventType: v.string(),
		paymentId: v.optional(v.id(TABLE.PAYMENTS)),
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query(TABLE.STRIPE_WEBHOOK_EVENTS)
			.withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
			.first();
		if (existing) {
			return existing._id;
		}

		const now = Date.now();
		return await ctx.db.insert(TABLE.STRIPE_WEBHOOK_EVENTS, {
			eventId: args.eventId,
			eventType: args.eventType,
			paymentId: args.paymentId,
			processedAt: now,
			createdAt: now,
		});
	},
});

// =============================================================================
// Refund & Dispute webhook persistence (charge.refunded / charge.dispute.*)
// =============================================================================
// See `convex/stripeWebhookHelpers.ts` for the routing rationale (these events
// land on the STANDARD webhook because the platform is the losses_collector on
// destination charges). The node-side handlers in `convex/_util/stripe.ts`
// resolve the payment from the charge's PaymentIntent, then call these.

/**
 * Records refund facts derived from a `charge.refunded` event onto the payment.
 * Idempotent: re-applying the same facts is a harmless no-op, and duplicate
 * webhook deliveries are already short-circuited upstream via
 * `stripeWebhookEvents`. Full refunds also flip the linked order to "refunded"
 * (session/tab payments have no dedicated refunded state, so only the payment
 * record is updated there). Also surfaces manual Stripe-dashboard refunds.
 *
 * Order-independent: `charge.refunded` fires once per refund and Stripe does
 * not promise delivery order, so a partial refund's event can arrive after the
 * full refund's. The stored total only ever grows (`mergeRefundTotals`), and a
 * fully refunded payment never goes back to `partial` — that regression would
 * count a refunded sale as revenue again.
 */
export const recordChargeRefund = internalMutation({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		amountRefunded: v.number(),
		amountCaptured: v.number(),
		isFullyRefunded: v.boolean(),
		stripeRefundId: v.optional(v.string()),
		refundedAtMs: v.optional(v.number()),
		latestStripeEventId: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const payment = await ctx.db.get(args.paymentId);
		if (!payment) return;

		const now = Date.now();
		const totals = mergeRefundTotals(payment, {
			amountRefunded: args.amountRefunded,
			isFullyRefunded: args.isFullyRefunded,
			amountCaptured: args.amountCaptured,
		});
		const refundStatus = totals.isFullyRefunded
			? PAYMENT_REFUND_STATUS.SUCCEEDED
			: PAYMENT_REFUND_STATUS.PARTIAL;

		await ctx.db.patch(args.paymentId, {
			refundStatus,
			amountRefunded: totals.amountRefunded,
			...(args.stripeRefundId !== undefined && { stripeRefundId: args.stripeRefundId }),
			...(args.latestStripeEventId !== undefined && {
				latestStripeEventId: args.latestStripeEventId,
			}),
			// Stamped by the event that completed the refund, not by a late
			// partial arriving afterwards.
			...(totals.isFullyRefunded &&
				(args.isFullyRefunded || payment.refundedAt === undefined) && {
					refundedAt: args.refundedAtMs ?? now,
				}),
			// A failed reservation has nothing left to retry once the charge is
			// fully refunded (e.g. an operator finished it from the Dashboard).
			...(totals.isFullyRefunded &&
				payment.pendingRefund?.failedAt !== undefined && { pendingRefund: undefined }),
			updatedAt: now,
			updatedBy: AUDIT_SYSTEM_USER_ID,
		});

		// Only a payment that actually settled THIS ORDER can un-settle it. Three
		// conditions, and each one is load-bearing:
		//
		// - `status === SUCCEEDED`: a refund can land on a row that never
		//   settled. The amount-mismatch path (TAVLI-69) fails the row and asks an
		//   operator to refund the charge at Stripe, and that refund arrives here
		//   as `charge.refunded`. Flipping the order to REFUNDED then would be a
		//   lie in the worst direction — the diner never paid for it, so the order
		//   must stay unpaid and payable, not look like money that came and went.
		// - `order.activePaymentId === payment._id`: SUCCEEDED is no longer
		//   enough on its own (TAVLI-104). A charge the webhook could not place is
		//   now marked SUCCEEDED — it is true, Stripe collected — and refunded
		//   automatically, and that refund comes back through here. The order it
		//   names was left UNPAID and still owed, or is paid by a DIFFERENT
		//   payment; either way this row is not the one that settled it, and
		//   REFUNDED would erase an order the diner still has to pay for, or
		//   un-settle one that is genuinely paid.
		// - `paymentState` is PAID, REFUND_REQUESTED or REFUND_FAILED: the states
		//   a full refund can legitimately move to REFUNDED. REFUND_FAILED is in
		//   the set because a refund our call reported as failed can still have
		//   landed (or been finished from the Dashboard) — the diner has the
		//   money, and staff must not be sent to refund it again.
		//
		// The refund facts are recorded on the payment row above either way.
		if (totals.isFullyRefunded && payment.orderId && payment.status === PAYMENT_STATUS.SUCCEEDED) {
			const order = await ctx.db.get(payment.orderId);
			const settledThisOrder =
				order?.activePaymentId === args.paymentId &&
				(order.paymentState === ORDER_PAYMENT_STATE.PAID ||
					order.paymentState === ORDER_PAYMENT_STATE.REFUND_REQUESTED ||
					order.paymentState === ORDER_PAYMENT_STATE.REFUND_FAILED);
			if (order && settledThisOrder) {
				await ctx.db.patch(order._id, {
					paymentState: ORDER_PAYMENT_STATE.REFUNDED,
					updatedAt: now,
					updatedBy: AUDIT_SYSTEM_USER_ID,
				});
			}
		}

		// A refund on a payment that repaid a lost dispute has to give the ledger
		// its debt back (TAVLI-102): Stripe returns the diner's whole charge out
		// of the platform balance and reverses only the already-reduced transfer,
		// so Tavli recovered nothing. Same transaction as the refund record, so
		// the two can never disagree. Fed the merged cumulative total, so a late
		// partial event can never ask it to restore less than it already has.
		await restoreLedgerForRefund(ctx, {
			paymentId: args.paymentId,
			amountRefunded: totals.amountRefunded,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.PAYMENTS,
			aggregateId: args.paymentId,
			eventType: "payments.refundRecorded",
			restaurantId: payment.restaurantId,
			payload: {
				amountRefunded: args.amountRefunded,
				amountCaptured: args.amountCaptured,
				isFullyRefunded: args.isFullyRefunded,
				refundStatus,
				stripeRefundId: args.stripeRefundId,
			},
			userId: AUDIT_SYSTEM_USER_ID,
			idempotencyKey: args.latestStripeEventId
				? `charge.refunded:${args.latestStripeEventId}`
				: undefined,
		});
	},
});

/**
 * Records `createRefund`'s side of a refund on the payment: the request, the
 * result, or the failure. The refund-aware sibling of `updatePayment`.
 *
 * Same monotonic rules as {@link recordChargeRefund}, because the two race:
 * the `charge.refunded` webhook for this very refund can commit before this
 * does. `amountRefunded`, when given, is Stripe's **cumulative** figure from
 * the refund's expanded charge — never this refund's amount — and is merged
 * with `max`, so whichever lands second changes nothing. A payment already
 * fully refunded stays `succeeded` whatever status is asked for: a stray
 * `requested` / `failed` / `partial` would put a refunded sale back into
 * revenue.
 */
export const recordRefundResultInternal = internalMutation({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		refundStatus: paymentRefundStatusValidator,
		amountRefunded: v.optional(v.number()),
		amountCaptured: v.optional(v.number()),
		isFullyRefunded: v.optional(v.boolean()),
		stripeRefundId: v.optional(v.string()),
		refundRequestedAt: v.optional(v.number()),
		refundedAt: v.optional(v.number()),
		failureMessage: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const payment = await ctx.db.get(args.paymentId);
		if (!payment) return;

		const totals =
			args.amountRefunded !== undefined
				? mergeRefundTotals(payment, {
						amountRefunded: args.amountRefunded,
						isFullyRefunded: args.isFullyRefunded ?? false,
						amountCaptured: args.amountCaptured,
					})
				: null;
		const fullyRefunded =
			totals?.isFullyRefunded === true || payment.refundStatus === PAYMENT_REFUND_STATUS.SUCCEEDED;
		const refundStatus = fullyRefunded ? PAYMENT_REFUND_STATUS.SUCCEEDED : args.refundStatus;

		await ctx.db.patch(args.paymentId, {
			refundStatus,
			...(totals && { amountRefunded: totals.amountRefunded }),
			...(args.stripeRefundId !== undefined && { stripeRefundId: args.stripeRefundId }),
			...(args.refundRequestedAt !== undefined && { refundRequestedAt: args.refundRequestedAt }),
			...(args.refundedAt !== undefined && { refundedAt: args.refundedAt }),
			...(args.failureMessage !== undefined && { failureMessage: args.failureMessage }),
			updatedAt: Date.now(),
		});
	},
});

/**
 * `recordChargeDispute` lived here until TAVLI-102 and is now
 * `disputes.recordDisputeEventInternal`.
 *
 * It moved because the mutation stopped being "persist these facts": a dispute
 * event now opens or credits back a recovery ledger row, maintains two
 * aggregates, notifies the restaurant's managers, mails them, and raises an
 * operator alert. That belongs beside the ledger it maintains rather than in
 * the general-purpose Stripe helper file — and the move is what lets the
 * webhook handlers and the ledger share one definition of what a phase means.
 */
