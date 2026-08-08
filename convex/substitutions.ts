/**
 * Substitution proposals for out-of-stock lines on **paid** orders
 * (ADR 008, TAVLI-71 Phase 3A).
 *
 * Flow: the kitchen can't make a paid line → staff propose an equal-or-higher
 * priced replacement (`deltaAmount >= 0`, enforced here) → the diner answers on
 * their own device:
 * - **Accept, delta 0** — `acceptProposal` swaps the line in place, total
 *   unchanged.
 * - **Accept, delta > 0** — the paid path: `stripe.createSubstitutionPaymentIntent`
 *   charges `delta + 12% fee on delta` (one-tap on the saved card, Elements
 *   3DS fallback) and the `payment_intent.succeeded` webhook lands in
 *   `confirmSubstitutionPayment`, which applies the swap and **raises** the
 *   order total by the delta. `acceptProposal` rejects positive deltas so the
 *   swap can never outrun the money.
 * - **Decline** — the line is 86'd and refunded exactly like a staff 86
 *   (shared core in `orderItemCancellation.ts`), with the diner as the audit
 *   actor.
 *
 * Substitutes carry **no options**: the proposed price is the menu item's
 * `basePrice` and the swapped line's `selectedOptions` are cleared — a
 * substitution is the kitchen's simple replacement dish, not a re-order flow.
 *
 * Guard interplay (documented + tested): a staff 86 on a line with a pending
 * proposal auto-cancels the proposal (`orderItemCancellation.ts`), and a
 * whole-order cancel withdraws every pending proposal on the order. If a delta
 * charge lands at Stripe after its proposal died, `confirmSubstitutionPayment`
 * refunds it in full.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import {
	ConflictError,
	NotFoundError,
	type NotAuthenticatedErrorObject,
	type NotAuthorizedErrorObject,
	type NotFoundErrorObject,
} from "./_shared/errors";
import type { AsyncReturn } from "./_shared/types";
import { appendAuditEvent } from "./_util/audit";
import { getCurrentUserId, requireRestaurantStaffAccess } from "./_util/auth";
import { isSessionMember, requireAuthenticatedDiner } from "./_util/dinerSession";
import {
	AUDIT_EVENT,
	AUDIT_SYSTEM_USER_ID,
	ORDER_PAYMENT_STATE,
	PAYMENT_KIND,
	PAYMENT_STATUS,
	PLATFORM_APPLICATION_FEE_RATE,
	SUBSTITUTION_PROPOSAL_STATUS,
	TABLE,
} from "./constants";
import { recalculateTotal } from "./orderHelpers";
import {
	executeOrderItemCancellation,
	retirePendingSupplementalPayment,
} from "./orderItemCancellation";
import { resolveSucceededPaymentForOrder } from "./orderRefundHelpers";

type StaffAuthErrors = NotAuthenticatedErrorObject | NotAuthorizedErrorObject;

/**
 * True when `payment` is a fee-inclusive ADR 008 order payment — the only
 * vintage substitutions work against. Legacy money (tab payments, pre-fee
 * per-order intents) can neither take a delta charge nor a per-line refund,
 * so proposals are refused on it up front.
 */
function isNewModelOrderPayment(payment: Doc<"payments"> | null): payment is Doc<"payments"> {
	return payment?.kind === PAYMENT_KIND.ORDER && payment.subtotalAmount !== undefined;
}

/**
 * Loads a pending proposal's session and asserts the caller is a member of it.
 * Membership, not opener-ship — the same predicate the pay-at-submit checkout
 * uses (`verifyOrderForPaymentInternal`).
 */
async function requireProposalSessionMember(
	ctx: Parameters<typeof requireAuthenticatedDiner>[0],
	proposal: Doc<"substitutionProposals">
): Promise<string> {
	const userId = await requireAuthenticatedDiner(ctx);
	const session = await ctx.db.get(proposal.sessionId);
	if (!session || session.status !== "active" || !isSessionMember(session, userId)) {
		// Generic not-found for wrong-member lookups to avoid ID enumeration,
		// mirroring `requireOwnedActiveSession`.
		throw new NotFoundError("Substitution proposal not found");
	}
	return userId;
}

/**
 * Applies an accepted proposal's swap to the order line: the line becomes the
 * proposed menu item (snapshotted name/price, options cleared — substitutes
 * carry no options), and the order total is recomputed. For a positive delta
 * this **raises** `order.totalAmount` by exactly `deltaAmount`, matching the
 * money the supplemental payment moved.
 *
 * Shared by `acceptProposal` (delta 0) and `confirmSubstitutionPayment`
 * (delta > 0, webhook-driven) so the swap semantics exist exactly once.
 */
async function applySubstitutionSwap(
	ctx: Parameters<typeof recalculateTotal>[0] & Parameters<typeof appendAuditEvent>[0],
	args: {
		proposal: Doc<"substitutionProposals">;
		item: Doc<"orderItems">;
		respondedByUserId: string;
		supplementalPaymentId?: Id<"payments">;
		auditIdempotencyKey?: string;
	}
): Promise<void> {
	const { proposal, item } = args;
	const now = Date.now();

	await ctx.db.patch(item._id, {
		menuItemId: proposal.proposedMenuItemId,
		menuItemName: proposal.proposedMenuItemName,
		unitPrice: proposal.proposedUnitPrice,
		lineTotal: proposal.proposedLineTotal,
		// Substitutes carry no options; the special instructions stay — staff
		// proposed the replacement with the note in view.
		selectedOptions: [],
	});
	await recalculateTotal(ctx, proposal.orderId);

	await ctx.db.patch(proposal._id, {
		status: SUBSTITUTION_PROPOSAL_STATUS.ACCEPTED,
		respondedByUserId: args.respondedByUserId,
		respondedAt: now,
		updatedAt: now,
		...(args.supplementalPaymentId !== undefined && {
			supplementalPaymentId: args.supplementalPaymentId,
		}),
	});

	await appendAuditEvent(ctx, {
		aggregateType: TABLE.SUBSTITUTION_PROPOSALS,
		aggregateId: proposal._id,
		eventType: AUDIT_EVENT.SUBSTITUTION_ACCEPTED,
		restaurantId: proposal.restaurantId,
		payload: {
			restaurantId: proposal.restaurantId,
			orderId: proposal.orderId,
			orderItemId: proposal.orderItemId,
			proposedMenuItemId: proposal.proposedMenuItemId,
			deltaAmount: proposal.deltaAmount,
			feeOnDelta: proposal.feeOnDelta,
			...(args.supplementalPaymentId !== undefined && {
				supplementalPaymentId: args.supplementalPaymentId,
			}),
		},
		userId: args.respondedByUserId,
		idempotencyKey: args.auditIdempotencyKey,
	});
}

// ============================================================================
// Staff-facing
// ============================================================================

/**
 * Staff propose a substitution for a paid line the kitchen can't make.
 *
 * Eligibility: order paid (`paymentState: "paid"`) and `submitted`/`preparing`;
 * the line alive (not 86'd, not refunded); no pending proposal already on the
 * line; the proposed MenuItem exists at this restaurant and is available; the
 * backing payment is a fee-inclusive ADR 008 order payment (legacy money is
 * refused — it can't take the delta charge or the decline refund).
 *
 * Pricing: `proposedUnitPrice = menuItem.basePrice` — **no options on
 * substitutes** — and `deltaAmount = proposedLineTotal - line.lineTotal` must
 * be `>= 0` (the equal-or-higher rule; ERROR_SUBSTITUTION_DELTA_NEGATIVE).
 * `feeOnDelta` is the customer-borne service fee on the delta alone.
 */
export const proposeSubstitution = mutation({
	args: {
		orderId: v.id(TABLE.ORDERS),
		orderItemId: v.id(TABLE.ORDER_ITEMS),
		proposedMenuItemId: v.id(TABLE.MENU_ITEMS),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"substitutionProposals">, StaffAuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const order = await ctx.db.get(args.orderId);
		if (!order) return [null, new NotFoundError("Order not found").toObject()];

		const [, restaurantError] = await requireRestaurantStaffAccess(ctx, userId, order.restaurantId);
		if (restaurantError) return [null, restaurantError];

		if (
			order.paymentState !== ORDER_PAYMENT_STATE.PAID ||
			(order.status !== "submitted" && order.status !== "preparing")
		) {
			throw new ConflictError("ERROR_SUBSTITUTION_NOT_ELIGIBLE");
		}

		const item = await ctx.db.get(args.orderItemId);
		if (!item || item.orderId !== args.orderId) {
			return [null, new NotFoundError("Order item not found").toObject()];
		}
		if (item.cancelledAt !== undefined || item.refundedAt !== undefined) {
			throw new ConflictError("ERROR_SUBSTITUTION_NOT_ELIGIBLE");
		}

		const proposals = await ctx.db
			.query(TABLE.SUBSTITUTION_PROPOSALS)
			.withIndex("by_order", (q) => q.eq("orderId", args.orderId))
			.collect();
		const hasPending = proposals.some(
			(p) => p.orderItemId === args.orderItemId && p.status === SUBSTITUTION_PROPOSAL_STATUS.PENDING
		);
		if (hasPending) {
			throw new ConflictError("ERROR_SUBSTITUTION_PROPOSAL_EXISTS");
		}

		const menuItem = await ctx.db.get(args.proposedMenuItemId);
		if (!menuItem || menuItem.restaurantId !== order.restaurantId || !menuItem.isAvailable) {
			throw new ConflictError("ERROR_SUBSTITUTION_ITEM_UNAVAILABLE");
		}

		// The decline path 86s-with-refund and the accept path charges a delta;
		// both only work against a fee-inclusive ADR 008 payment. Refusing legacy
		// money here keeps the proposal from ever reaching a dead end.
		const payment = await resolveSucceededPaymentForOrder(ctx, order);
		if (!isNewModelOrderPayment(payment)) {
			throw new ConflictError("ERROR_SUBSTITUTION_NOT_ELIGIBLE");
		}

		const quantity = item.quantity;
		const proposedUnitPrice = menuItem.basePrice;
		const proposedLineTotal = proposedUnitPrice * quantity;
		const deltaAmount = proposedLineTotal - item.lineTotal;
		if (deltaAmount < 0) {
			throw new ConflictError("ERROR_SUBSTITUTION_DELTA_NEGATIVE");
		}
		const feeOnDelta = Math.round(deltaAmount * PLATFORM_APPLICATION_FEE_RATE);

		const now = Date.now();
		const proposalId = await ctx.db.insert(TABLE.SUBSTITUTION_PROPOSALS, {
			restaurantId: order.restaurantId,
			sessionId: order.sessionId,
			orderId: args.orderId,
			orderItemId: args.orderItemId,
			proposedMenuItemId: args.proposedMenuItemId,
			proposedMenuItemName: menuItem.name,
			proposedUnitPrice,
			quantity,
			proposedLineTotal,
			deltaAmount,
			feeOnDelta,
			status: SUBSTITUTION_PROPOSAL_STATUS.PENDING,
			proposedBy: userId,
			createdAt: now,
			updatedAt: now,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.SUBSTITUTION_PROPOSALS,
			aggregateId: proposalId,
			eventType: AUDIT_EVENT.SUBSTITUTION_PROPOSED,
			restaurantId: order.restaurantId,
			payload: {
				restaurantId: order.restaurantId,
				sessionId: order.sessionId,
				orderId: args.orderId,
				orderItemId: args.orderItemId,
				proposedMenuItemId: args.proposedMenuItemId,
				deltaAmount,
				feeOnDelta,
			},
			userId,
		});

		return [proposalId, null];
	},
});

/**
 * Staff retract their own pending proposal before the diner answers
 * (pending → cancelled). Any in-flight delta payment row is retired in-app;
 * the webhook race is closed by {@link confirmSubstitutionPayment}.
 */
export const cancelProposal = mutation({
	args: { proposalId: v.id(TABLE.SUBSTITUTION_PROPOSALS) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<Id<"substitutionProposals">, StaffAuthErrors | NotFoundErrorObject> {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [null, error];

		const proposal = await ctx.db.get(args.proposalId);
		if (!proposal) return [null, new NotFoundError("Substitution proposal not found").toObject()];

		const [, restaurantError] = await requireRestaurantStaffAccess(
			ctx,
			userId,
			proposal.restaurantId
		);
		if (restaurantError) return [null, restaurantError];

		if (proposal.status !== SUBSTITUTION_PROPOSAL_STATUS.PENDING) {
			throw new ConflictError("ERROR_SUBSTITUTION_NOT_PENDING");
		}

		await ctx.db.patch(args.proposalId, {
			status: SUBSTITUTION_PROPOSAL_STATUS.CANCELLED,
			updatedAt: Date.now(),
		});
		await retirePendingSupplementalPayment(ctx, proposal);

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.SUBSTITUTION_PROPOSALS,
			aggregateId: args.proposalId,
			eventType: AUDIT_EVENT.SUBSTITUTION_CANCELLED,
			restaurantId: proposal.restaurantId,
			payload: {
				restaurantId: proposal.restaurantId,
				orderId: proposal.orderId,
				orderItemId: proposal.orderItemId,
				proposedMenuItemId: proposal.proposedMenuItemId,
				reason: "staff_retracted",
			},
			userId,
		});

		return [args.proposalId, null];
	},
});

/**
 * Staff view: pending proposals for a restaurant, for the kitchen dashboard's
 * per-line badges. Returns `[]` for non-staff (the dashboard shell handles
 * access separately), mirroring `menuItems.listByRestaurantForStaff`.
 */
export const getPendingForRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		const [userId, error] = await getCurrentUserId(ctx);
		if (error) return [];
		const [, accessError] = await requireRestaurantStaffAccess(ctx, userId, args.restaurantId);
		if (accessError) return [];

		return await ctx.db
			.query(TABLE.SUBSTITUTION_PROPOSALS)
			.withIndex("by_restaurant_status", (q) =>
				q.eq("restaurantId", args.restaurantId).eq("status", SUBSTITUTION_PROPOSAL_STATUS.PENDING)
			)
			.collect();
	},
});

// ============================================================================
// Diner-facing
// ============================================================================

/**
 * Pending proposals for the diner's session, joined with the original line so
 * the prompt can show "X → Y" with the exact price delta. Session-member
 * gated; returns `[]` rather than throwing so it can be mounted in the diner
 * layout unconditionally (mirrors `orders.getOrdersBySession`).
 */
export const getPendingForSession = query({
	args: { sessionId: v.id(TABLE.SESSIONS) },
	handler: async (ctx, args) => {
		let userId: string;
		try {
			userId = await requireAuthenticatedDiner(ctx);
		} catch {
			return [];
		}
		const session = await ctx.db.get(args.sessionId);
		if (!session || session.status !== "active" || !isSessionMember(session, userId)) {
			return [];
		}

		const proposals = await ctx.db
			.query(TABLE.SUBSTITUTION_PROPOSALS)
			.withIndex("by_session_status", (q) =>
				q.eq("sessionId", args.sessionId).eq("status", SUBSTITUTION_PROPOSAL_STATUS.PENDING)
			)
			.collect();

		const joined = await Promise.all(
			proposals.map(async (proposal) => {
				const item = await ctx.db.get(proposal.orderItemId);
				const order = await ctx.db.get(proposal.orderId);
				if (!item || !order) return null;
				return {
					proposalId: proposal._id,
					orderId: proposal.orderId,
					dailyOrderNumber: order.dailyOrderNumber ?? null,
					orderItemId: proposal.orderItemId,
					originalName: item.menuItemName,
					originalLineTotal: item.lineTotal,
					quantity: proposal.quantity,
					proposedName: proposal.proposedMenuItemName,
					proposedLineTotal: proposal.proposedLineTotal,
					deltaAmount: proposal.deltaAmount,
					feeOnDelta: proposal.feeOnDelta,
					createdAt: proposal.createdAt,
				};
			})
		);
		return joined
			.filter((p): p is NonNullable<typeof p> => p !== null)
			.sort((a, b) => a.createdAt - b.createdAt);
	},
});

/**
 * The diner accepts a **zero-delta** proposal: the swap applies atomically and
 * the order total is unchanged. Positive deltas are rejected here with
 * ERROR_SUBSTITUTION_REQUIRES_PAYMENT — that path must go through
 * `stripe.createSubstitutionPaymentIntent` so the swap can never outrun the
 * money (the webhook applies it in {@link confirmSubstitutionPayment}).
 */
export const acceptProposal = mutation({
	args: { proposalId: v.id(TABLE.SUBSTITUTION_PROPOSALS) },
	handler: async (ctx, args) => {
		const proposal = await ctx.db.get(args.proposalId);
		if (!proposal) throw new NotFoundError("Substitution proposal not found");

		const userId = await requireProposalSessionMember(ctx, proposal);

		if (proposal.status !== SUBSTITUTION_PROPOSAL_STATUS.PENDING) {
			throw new ConflictError("ERROR_SUBSTITUTION_NOT_PENDING");
		}
		if (proposal.deltaAmount !== 0) {
			throw new ConflictError("ERROR_SUBSTITUTION_REQUIRES_PAYMENT");
		}

		const item = await ctx.db.get(proposal.orderItemId);
		if (!item || item.cancelledAt !== undefined) {
			// The line died under the proposal (auto-cancel should have caught
			// this; defensive).
			throw new ConflictError("ERROR_SUBSTITUTION_NOT_ELIGIBLE");
		}

		await applySubstitutionSwap(ctx, {
			proposal,
			item,
			respondedByUserId: userId,
		});

		return proposal._id;
	},
});

/**
 * The diner declines the proposal: pending → declined, then the line is 86'd
 * and refunded **exactly** like a staff 86 — the shared core in
 * `orderItemCancellation.ts` stamps the line and schedules
 * `stripe.refundOrderItem` — with the diner as the audit actor.
 *
 * Works while the line is alive and the order not cancelled, whatever the
 * order's kitchen status: the food this line describes was never made, so the
 * money comes back even if the rest of the order has advanced to ready.
 */
export const declineProposal = mutation({
	args: { proposalId: v.id(TABLE.SUBSTITUTION_PROPOSALS) },
	handler: async (ctx, args) => {
		const proposal = await ctx.db.get(args.proposalId);
		if (!proposal) throw new NotFoundError("Substitution proposal not found");

		const userId = await requireProposalSessionMember(ctx, proposal);

		if (proposal.status !== SUBSTITUTION_PROPOSAL_STATUS.PENDING) {
			throw new ConflictError("ERROR_SUBSTITUTION_NOT_PENDING");
		}

		const item = await ctx.db.get(proposal.orderItemId);
		const order = await ctx.db.get(proposal.orderId);
		if (!item || !order || item.cancelledAt !== undefined || order.status === "cancelled") {
			throw new ConflictError("ERROR_SUBSTITUTION_NOT_ELIGIBLE");
		}

		// Resolve the money BEFORE stamping anything: a paid line whose payment
		// cannot be found must not end up 86'd with no refund on its way —
		// mirrors `orders.cancelOrderItem`.
		const payment = await resolveSucceededPaymentForOrder(ctx, order);
		if (!isNewModelOrderPayment(payment)) {
			throw new ConflictError("ERROR_REFUND_PAYMENT_UNRESOLVED");
		}

		const now = Date.now();
		await ctx.db.patch(args.proposalId, {
			status: SUBSTITUTION_PROPOSAL_STATUS.DECLINED,
			respondedByUserId: userId,
			respondedAt: now,
			updatedAt: now,
		});
		// A half-paid delta intent dies with the proposal (in-app; the webhook
		// race is closed by confirmSubstitutionPayment's auto-refund).
		await retirePendingSupplementalPayment(ctx, proposal);

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.SUBSTITUTION_PROPOSALS,
			aggregateId: args.proposalId,
			eventType: AUDIT_EVENT.SUBSTITUTION_DECLINED,
			restaurantId: proposal.restaurantId,
			payload: {
				restaurantId: proposal.restaurantId,
				orderId: proposal.orderId,
				orderItemId: proposal.orderItemId,
				proposedMenuItemId: proposal.proposedMenuItemId,
				deltaAmount: proposal.deltaAmount,
			},
			userId,
		});

		// The 86-with-refund, shared verbatim with the staff path. Actor = diner.
		await executeOrderItemCancellation(ctx, {
			item,
			order,
			actorUserId: userId,
			paidPaymentId: payment._id,
		});

		return proposal._id;
	},
});

// ============================================================================
// Internal (Stripe action + webhook support)
// ============================================================================

/**
 * Access check for `stripe.createSubstitutionPaymentIntent`: returns the
 * proposal only when the caller is a member of its active session. `null`
 * means "no access" — status/delta validation stays in the action so it can
 * surface precise stable codes.
 */
export const verifyProposalForPaymentInternal = internalQuery({
	args: {
		proposalId: v.id(TABLE.SUBSTITUTION_PROPOSALS),
		userId: v.string(),
	},
	handler: async (ctx, args): Promise<Doc<"substitutionProposals"> | null> => {
		const proposal = await ctx.db.get(args.proposalId);
		if (!proposal) return null;
		const session = await ctx.db.get(proposal.sessionId);
		if (!session || session.status !== "active" || !isSessionMember(session, args.userId)) {
			return null;
		}
		return proposal;
	},
});

/**
 * The saved card for one-tap delta charges: the payment method persisted by
 * the member's latest succeeded pay-at-submit charge in this session
 * (`setup_future_usage: "off_session"` attached it to their platform-level
 * Stripe Customer). Kind-"order" payments carry `orderId` (not `sessionId`),
 * so the lookup walks the session's orders.
 */
export const getSavedCardForSessionMemberInternal = internalQuery({
	args: {
		sessionId: v.id(TABLE.SESSIONS),
		userId: v.string(),
	},
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, args): Promise<string | null> => {
		const orders = await ctx.db
			.query(TABLE.ORDERS)
			.withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
			.collect();

		let best: { paidAt: number; paymentMethodId: string } | null = null;
		for (const order of orders) {
			if (order.paidByUserId !== args.userId || !order.activePaymentId) continue;
			const payment = await ctx.db.get(order.activePaymentId);
			if (
				payment?.status === PAYMENT_STATUS.SUCCEEDED &&
				payment.kind === PAYMENT_KIND.ORDER &&
				payment.stripePaymentMethodId
			) {
				const paidAt = payment.succeededAt ?? payment.createdAt;
				if (!best || paidAt > best.paidAt) {
					best = { paidAt, paymentMethodId: payment.stripePaymentMethodId };
				}
			}
		}
		return best?.paymentMethodId ?? null;
	},
});

/**
 * Records the freshly-created supplemental payment on its proposal so the
 * webhook (and idempotent re-calls of the intent action) can find it.
 */
export const attachSupplementalPaymentInternal = internalMutation({
	args: {
		proposalId: v.id(TABLE.SUBSTITUTION_PROPOSALS),
		paymentId: v.id(TABLE.PAYMENTS),
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.proposalId, {
			supplementalPaymentId: args.paymentId,
			updatedAt: Date.now(),
		});
	},
});

/**
 * Every accepted proposal on an order, in creation order — the one place the
 * `by_order` index is read for refund purposes, so the line-scoped and
 * order-scoped refund paths can never disagree about what "accepted" means.
 */
async function loadAcceptedProposalsForOrder(
	ctx: { db: DatabaseReader },
	orderId: Id<"orders">
): Promise<Doc<"substitutionProposals">[]> {
	const proposals = await ctx.db
		.query(TABLE.SUBSTITUTION_PROPOSALS)
		.withIndex("by_order", (q) => q.eq("orderId", orderId))
		.collect();
	return proposals
		.filter((p) => p.status === SUBSTITUTION_PROPOSAL_STATUS.ACCEPTED)
		.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Accepted proposals (with their money) for one line — the cross-payment
 * refund in `stripe.refundOrderItem` uses this to split an 86'd substituted
 * line's refund between the order payment and the substitution payment(s).
 */
export const getAcceptedProposalsForItemInternal = internalQuery({
	args: {
		orderId: v.id(TABLE.ORDERS),
		orderItemId: v.id(TABLE.ORDER_ITEMS),
	},
	handler: async (ctx, args): Promise<Doc<"substitutionProposals">[]> => {
		const proposals = await loadAcceptedProposalsForOrder(ctx, args.orderId);
		return proposals.filter((p) => p.orderItemId === args.orderItemId);
	},
});

/**
 * Accepted proposals for a whole order — the order-scoped sibling of
 * {@link getAcceptedProposalsForItemInternal}, read by the whole-order refund
 * sweep in `stripe.cancelOrderAndRefund`.
 *
 * A whole-order cancel has to return the delta money too: each accepted
 * proposal was charged on its **own** PaymentIntent, so refunding only the
 * order payment leaves the diner out of pocket by every accepted delta.
 */
export const getAcceptedProposalsForOrderInternal = internalQuery({
	args: { orderId: v.id(TABLE.ORDERS) },
	handler: async (ctx, args): Promise<Doc<"substitutionProposals">[]> =>
		await loadAcceptedProposalsForOrder(ctx, args.orderId),
});

/**
 * Webhook half of the paid substitution path — wired into the kind dispatch in
 * `_util/stripe.ts` (`payment_intent.succeeded`, kind "substitution").
 *
 * Idempotent: a proposal already accepted is a no-op replay. If the proposal
 * died while the charge was in flight (staff 86, whole-order cancel, decline —
 * all of which retire the payment row in-app but cannot reach Stripe), the
 * money is returned in full via a scheduled `stripe.createRefund`; nothing is
 * swapped.
 */
export const confirmSubstitutionPayment = internalMutation({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		stripePaymentIntentId: v.string(),
		stripeChargeId: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const payment = await ctx.db.get(args.paymentId);
		if (!payment) throw new Error(`Payment ${args.paymentId} not found`);
		if (payment.kind !== PAYMENT_KIND.SUBSTITUTION || !payment.substitutionProposalId) {
			throw new Error(`Payment ${args.paymentId} is not a substitution payment`);
		}

		const proposal = await ctx.db.get(payment.substitutionProposalId);
		if (!proposal) throw new Error(`Proposal ${payment.substitutionProposalId} not found`);

		const now = Date.now();
		// The charge happened whatever our row said (a retired row can still be
		// confirmed at Stripe) — record the money truthfully first.
		if (payment.status !== PAYMENT_STATUS.SUCCEEDED) {
			await ctx.db.patch(payment._id, {
				status: PAYMENT_STATUS.SUCCEEDED,
				stripePaymentIntentId: args.stripePaymentIntentId,
				...(args.stripeChargeId !== undefined && { stripeChargeId: args.stripeChargeId }),
				succeededAt: now,
				updatedAt: now,
				updatedBy: AUDIT_SYSTEM_USER_ID,
			});
		}

		// Idempotent replay: the swap already happened.
		if (proposal.status === SUBSTITUTION_PROPOSAL_STATUS.ACCEPTED) return;

		const item = await ctx.db.get(proposal.orderItemId);
		const order = await ctx.db.get(proposal.orderId);
		const proposalIsDead = proposal.status !== SUBSTITUTION_PROPOSAL_STATUS.PENDING;
		const lineIsDead = !item || item.cancelledAt !== undefined;
		const orderIsDead = !order || order.status === "cancelled";

		if (proposalIsDead || lineIsDead || orderIsDead) {
			// The proposal died under the charge — return the delta in full.
			console.error(
				`[substitutions.confirmSubstitutionPayment] payment ${payment._id} succeeded for ` +
					`proposal ${proposal._id} (status ${proposal.status}) whose line/order is no longer ` +
					"eligible — refunding the delta in full"
			);
			if (proposal.status === SUBSTITUTION_PROPOSAL_STATUS.PENDING) {
				await ctx.db.patch(proposal._id, {
					status: SUBSTITUTION_PROPOSAL_STATUS.CANCELLED,
					updatedAt: now,
				});
			}
			await ctx.scheduler.runAfter(0, internal.stripe.createRefund, {
				paymentId: payment._id,
				orderId: payment.orderId,
				idempotencyKey: `refund:${payment._id}`,
				skipOrderStatePatch: true,
			});
			return;
		}

		await applySubstitutionSwap(ctx, {
			proposal,
			item,
			respondedByUserId: payment.paidByUserId ?? AUDIT_SYSTEM_USER_ID,
			supplementalPaymentId: payment._id,
			auditIdempotencyKey: args.stripePaymentIntentId,
		});
	},
});

/**
 * Failure half (`payment_intent.payment_failed`, kind "substitution"): the
 * payment row is marked failed and the proposal **stays pending** so the diner
 * can retry (a fresh intent supersedes the failed row).
 */
export const failSubstitutionPayment = internalMutation({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		stripePaymentIntentId: v.string(),
		failureCode: v.optional(v.string()),
		failureMessage: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const payment = await ctx.db.get(args.paymentId);
		if (!payment?.substitutionProposalId) return;
		if (payment.status === PAYMENT_STATUS.SUCCEEDED) return;

		const now = Date.now();
		await ctx.db.patch(payment._id, {
			status: PAYMENT_STATUS.FAILED,
			stripePaymentIntentId: args.stripePaymentIntentId,
			...(args.failureCode !== undefined && { failureCode: args.failureCode }),
			...(args.failureMessage !== undefined && { failureMessage: args.failureMessage }),
			failedAt: now,
			updatedAt: now,
		});

		if (payment.orderId) {
			await appendAuditEvent(ctx, {
				aggregateType: TABLE.ORDERS,
				aggregateId: payment.orderId,
				eventType: AUDIT_EVENT.ORDER_PAYMENT_FAILED,
				restaurantId: payment.restaurantId,
				payload: {
					paymentId: payment._id,
					substitutionProposalId: payment.substitutionProposalId,
					amount: payment.amount,
					failureCode: args.failureCode,
					failureMessage: args.failureMessage,
					stripePaymentIntentId: args.stripePaymentIntentId,
				},
				userId: AUDIT_SYSTEM_USER_ID,
				idempotencyKey: args.stripePaymentIntentId,
			});
		}
	},
});
