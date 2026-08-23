/**
 * Receipt email internals (ADR 008 / TAVLI-71 Phase 3C).
 *
 * Receipts are PULL-ONLY: nothing auto-sends on webhooks. The diner taps
 * "Email me a receipt" on a paid order, and `receiptActions.sendReceiptEmail`
 * ("use node") drives these internal functions:
 *
 *   1. `getReceiptEmailContextInternal` — membership + paid gate, then the
 *      full composition context (order, items, payment split, tips, restaurant
 *      branding/tax block).
 *   2. `consumeReceiptEmailRateLimit` — fixed-window cap so a tap-happy diner
 *      (or a scripted one) can't turn the restaurant's identity into spam.
 *   3. `recordReceiptEmailSent` — `receipts.emailSent` audit event.
 */
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { appendAuditEvent } from "./_util/audit";
import { isSessionMember } from "./_util/dinerSession";
import type { RateLimitConfig } from "./_util/rateLimit";
import { consumeRateLimit } from "./_util/rateLimit";
import { resolveRestaurantTimezone } from "./_util/timezone";
import { AUDIT_EVENT, ORDER_PAYMENT_STATE, PAYMENT_KIND, PAYMENT_STATUS, TABLE } from "./constants";
import { toWhatsAppUrl } from "./publicProfileHelpers";

/** Max 3 receipt emails per order per rolling hour (fixed-window approximation). */
export const RECEIPT_EMAIL_RATE_LIMIT: RateLimitConfig = {
	windowMs: 60 * 60 * 1000,
	max: 3,
};

/** Stable failure codes the action converts into typed errors. */
export const RECEIPT_CONTEXT_BLOCKED = {
	NOT_FOUND: "NOT_FOUND",
	NOT_MEMBER: "NOT_MEMBER",
	NOT_PAID: "NOT_PAID",
} as const;

export type ReceiptContextBlockReason =
	(typeof RECEIPT_CONTEXT_BLOCKED)[keyof typeof RECEIPT_CONTEXT_BLOCKED];

export type ReceiptEmailOrderContext = {
	ok: true;
	restaurantId: Id<"restaurants">;
	sessionId: Id<"sessions">;
	restaurantName: string;
	/** Doubles as the receipt's `reply_to` and, when reviewed, the printed contact. */
	supportEmail: string | null;
	/** Public profile, for the contact block under the not-a-CFDI footer. */
	contactPhone: string | null;
	contactWhatsAppUrl: string | null;
	timezone: string;
	taxInfo: { rfc?: string; razonSocial?: string; fiscalAddress?: string };
	orderNumber: number | null;
	orderDateMs: number;
	items: Array<{ name: string; quantity: number; lineTotalCents: number; refunded: boolean }>;
	subtotalCents: number;
	feeCents: number;
	totalCents: number;
	tipCents: number | null;
	paymentHint: "card" | "in_person";
};

export type ReceiptEmailContextResult =
	| ReceiptEmailOrderContext
	| { ok: false; code: ReceiptContextBlockReason };

/**
 * Everything the receipt email needs, guarded by the same diner predicate the
 * ordering surface uses: the caller must be a member of the order's session
 * (opener or join-code joiner). Deliberately does NOT require the session to
 * still be active — diners ask for receipts after the visit closes.
 *
 * Money comes from the payment row that actually charged the order (display
 * what was charged, never recompute from the rate). Cash orders
 * (`settledBy: "staff"`, no payments row by design — see
 * `markOrderPaidInPerson`) fall back to the order total with a zero fee: cash
 * carries no Tavli service fee.
 */
export const getReceiptEmailContextInternal = internalQuery({
	args: {
		orderId: v.id(TABLE.ORDERS),
		userId: v.string(),
	},
	handler: async (ctx, args): Promise<ReceiptEmailContextResult> => {
		const order = await ctx.db.get(args.orderId);
		if (!order) return { ok: false, code: RECEIPT_CONTEXT_BLOCKED.NOT_FOUND };

		const session = await ctx.db.get(order.sessionId);
		if (!session || !isSessionMember(session, args.userId)) {
			return { ok: false, code: RECEIPT_CONTEXT_BLOCKED.NOT_MEMBER };
		}

		if (order.paymentState !== ORDER_PAYMENT_STATE.PAID) {
			return { ok: false, code: RECEIPT_CONTEXT_BLOCKED.NOT_PAID };
		}

		const restaurant = await ctx.db.get(order.restaurantId);
		if (!restaurant) return { ok: false, code: RECEIPT_CONTEXT_BLOCKED.NOT_FOUND };

		const orderItems = await ctx.db
			.query(TABLE.ORDER_ITEMS)
			.withIndex("by_order", (q) => q.eq("orderId", args.orderId))
			.collect();

		// Live lines plus post-payment refunded lines (struck-through on the
		// receipt). Lines 86'd BEFORE payment were never part of the charge, so
		// they are excluded — this keeps the item column summing to the charged
		// subtotal.
		const items = orderItems
			.filter((item) => item.cancelledAt === undefined || item.refundedAt !== undefined)
			.map((item) => ({
				name: item.menuItemName,
				quantity: item.quantity,
				lineTotalCents: item.lineTotal,
				refunded: item.refundedAt !== undefined,
			}));

		// The succeeded pay-at-submit charge, when there is one. Cash orders and
		// legacy (pre-pivot) paid orders have none.
		const activePayment = order.activePaymentId ? await ctx.db.get(order.activePaymentId) : null;
		const orderPayment =
			activePayment?.status === PAYMENT_STATUS.SUCCEEDED &&
			activePayment.kind === PAYMENT_KIND.ORDER
				? activePayment
				: null;

		const subtotalCents = orderPayment?.subtotalAmount ?? order.totalAmount;
		const feeCents = orderPayment?.feeAmount ?? 0;
		const totalCents = orderPayment?.amount ?? subtotalCents + feeCents;

		// The caller's own settled tips for this visit (tips are session-scoped
		// payments, never fee-bearing).
		const sessionPayments = await ctx.db
			.query(TABLE.PAYMENTS)
			.withIndex("by_session", (q) => q.eq("sessionId", order.sessionId))
			.collect();
		const tipCents = sessionPayments
			.filter(
				(p) =>
					p.kind === PAYMENT_KIND.TIP &&
					p.paidByUserId === args.userId &&
					p.status === PAYMENT_STATUS.SUCCEEDED
			)
			.reduce((sum, p) => sum + p.amount, 0);

		return {
			ok: true,
			restaurantId: order.restaurantId,
			sessionId: order.sessionId,
			restaurantName: restaurant.name,
			supportEmail: restaurant.supportEmail ?? null,
			contactPhone: restaurant.phone ?? null,
			contactWhatsAppUrl:
				restaurant.phone && restaurant.phoneHasWhatsApp ? toWhatsAppUrl(restaurant.phone) : null,
			timezone: resolveRestaurantTimezone(restaurant.timezone),
			taxInfo: {
				rfc: restaurant.rfc,
				razonSocial: restaurant.razonSocial,
				fiscalAddress: restaurant.fiscalAddress,
			},
			orderNumber: order.dailyOrderNumber ?? null,
			orderDateMs: order.paidAt ?? order.submittedAt ?? order.createdAt,
			items,
			subtotalCents,
			feeCents,
			totalCents,
			tipCents: tipCents > 0 ? tipCents : null,
			paymentHint: order.settledBy === "staff" ? "in_person" : "card",
		};
	},
});

/**
 * Consumes one send from the per-order budget ({@link RECEIPT_EMAIL_RATE_LIMIT}).
 * Runs BEFORE the Resend call so a rejected hit never emails. Returns whether
 * the send may proceed — the action converts `false` into the stable
 * `ERROR_RECEIPT_RATE_LIMITED` code.
 */
export const consumeReceiptEmailRateLimit = internalMutation({
	args: { orderId: v.id(TABLE.ORDERS) },
	returns: v.boolean(),
	handler: async (ctx, args): Promise<boolean> => {
		const decision = await consumeRateLimit(
			ctx,
			`receipt_email:${args.orderId}`,
			RECEIPT_EMAIL_RATE_LIMIT
		);
		return decision.allowed;
	},
});

/** Audit trail for sent receipts (recipient logged plainly, like invite emails). */
export const recordReceiptEmailSent = internalMutation({
	args: {
		orderId: v.id(TABLE.ORDERS),
		restaurantId: v.id(TABLE.RESTAURANTS),
		sessionId: v.id(TABLE.SESSIONS),
		recipient: v.string(),
		locale: v.string(),
		userId: v.string(),
	},
	handler: async (ctx, args) => {
		await appendAuditEvent(ctx, {
			aggregateType: TABLE.ORDERS,
			aggregateId: String(args.orderId),
			eventType: AUDIT_EVENT.RECEIPT_EMAIL_SENT,
			restaurantId: args.restaurantId,
			payload: {
				orderId: args.orderId,
				sessionId: args.sessionId,
				recipient: args.recipient,
				locale: args.locale,
			},
			userId: args.userId,
		});
	},
});
