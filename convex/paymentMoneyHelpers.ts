/**
 * Pure money-split helpers for the ADR 008 payment model.
 *
 * Under ADR 008 a `payments` row is no longer "what the restaurant earned":
 *
 * - `amount === subtotalAmount + feeAmount` — the customer-borne 12% Tavli
 *   service fee lives **inside** `amount`.
 * - Tips are their own rows (`kind: "tip"`, whole amount in `gratuityAmount`,
 *   no `orderId`), so summing `amount` double-counts them as food sales.
 * - A cash order (`orders.settledBy === "staff"`, `markOrderPaidInPerson`)
 *   moves real restaurant money with **no `payments` row at all**.
 *
 * Every revenue aggregate therefore needs the same three rules, which is why
 * they live here instead of being re-derived per widget:
 *
 * 1. Restaurant revenue = `subtotalAmount` when present, `amount` for legacy
 *    (pre-pivot) rows that predate the split.
 * 2. Tip rows contribute zero restaurant revenue.
 * 3. Cash orders contribute `orders.totalAmount`.
 *
 * **Deliberate non-restatement of legacy rows.** A pre-pivot row carries the
 * tip inside `amount` (tab settlement charged subtotal + tip) and had the 12%
 * carved *out* of the restaurant's proceeds by Stripe, a number we never
 * recorded. We do not reconstruct either: legacy buckets keep reporting what
 * they always reported (`amount`), so historical dashboards stay stable, and
 * `serviceFee` / `netToRestaurant` report `null` rather than a fabricated
 * split. The cutover discontinuity is documented, not papered over.
 *
 * **Refunds are out of scope here.** These helpers report gross money in;
 * no aggregate has ever netted `amountRefunded` out of revenue and doing so
 * silently would restate history a second time.
 */
import { PAYMENT_KIND, PAYMENT_STATUS, SETTLED_BY } from "./constants";
import type { PaymentKind, PaymentStatus, SettledBy } from "./constants";

/**
 * Structural shape of the `payments` fields these helpers read. Deliberately
 * not `Doc<"payments">` so denormalized export rows and test fixtures can be
 * passed straight in.
 */
export type PaymentMoneyRow = {
	amount: number;
	subtotalAmount?: number;
	feeAmount?: number;
	gratuityAmount?: number;
	kind?: PaymentKind;
	status: PaymentStatus;
};

/** Structural shape of the `orders` fields these helpers read. */
export type OrderMoneyRow = {
	totalAmount: number;
	paidAt?: number;
	settledBy?: SettledBy;
};

export type PaymentMoneyBreakdown = {
	/** `payments.amount` — the total the diner was charged on this row. */
	chargedToDiner: number;
	/** Food value the restaurant sold: the subtotal, zero on tip rows. */
	restaurantRevenue: number;
	/** Tavli service fee, or `null` on legacy rows where it was never recorded. */
	serviceFee: number | null;
	/** Tip portion of this row (whole amount on `kind: "tip"` rows). */
	tip: number;
	/**
	 * What the restaurant receives from this row: revenue + tip. `null` on
	 * legacy rows — Stripe carved an unrecorded 12% out of their proceeds.
	 */
	netToRestaurant: number | null;
};

/** True for rows written after the ADR 008 pivot (they carry the fee split). */
export function hasFeeBreakdown(payment: PaymentMoneyRow): boolean {
	return payment.subtotalAmount !== undefined;
}

/**
 * Full split of one payment row. Status-agnostic — callers that only want
 * settled money filter on `status` first (or use
 * {@link restaurantRevenueFromPayment}, which does).
 */
export function paymentMoneyBreakdown(payment: PaymentMoneyRow): PaymentMoneyBreakdown {
	const isTip = payment.kind === PAYMENT_KIND.TIP;
	const tip = isTip ? payment.amount : (payment.gratuityAmount ?? 0);
	const restaurantRevenue = isTip ? 0 : (payment.subtotalAmount ?? payment.amount);
	const serviceFee = hasFeeBreakdown(payment) ? (payment.feeAmount ?? 0) : null;

	return {
		chargedToDiner: payment.amount,
		restaurantRevenue,
		serviceFee,
		tip,
		netToRestaurant: serviceFee === null ? null : restaurantRevenue + tip,
	};
}

/**
 * Restaurant revenue (food only — not Tavli's cut, not tips) contributed by
 * one payment row. Returns 0 for anything that is not a succeeded charge.
 */
export function restaurantRevenueFromPayment(payment: PaymentMoneyRow): number {
	if (payment.status !== PAYMENT_STATUS.SUCCEEDED) return 0;
	return paymentMoneyBreakdown(payment).restaurantRevenue;
}

/**
 * Tip money contributed by one payment row: the whole amount of a
 * `kind: "tip"` row, or the `gratuityAmount` folded into a legacy tab
 * settlement. Returns 0 for anything that is not a succeeded charge.
 */
export function tipFromPayment(payment: PaymentMoneyRow): number {
	if (payment.status !== PAYMENT_STATUS.SUCCEEDED) return 0;
	return paymentMoneyBreakdown(payment).tip;
}

/** Σ {@link restaurantRevenueFromPayment} over a payment set. */
export function sumRestaurantRevenueFromPayments(payments: ReadonlyArray<PaymentMoneyRow>): number {
	let total = 0;
	for (const payment of payments) total += restaurantRevenueFromPayment(payment);
	return total;
}

/**
 * True for an order settled in person (`markOrderPaidInPerson`). These are the
 * paid orders with **no** `payments` row, so every payments-sourced aggregate
 * has to add them back from `orders.totalAmount` or under-report cash sales.
 */
export function isCashSettledOrder(order: OrderMoneyRow): boolean {
	return order.settledBy === SETTLED_BY.STAFF && order.paidAt !== undefined;
}

/** Σ `totalAmount` of the cash-settled orders in the set. */
export function sumCashSettledOrderRevenue(orders: ReadonlyArray<OrderMoneyRow>): number {
	let total = 0;
	for (const order of orders) {
		if (isCashSettledOrder(order)) total += order.totalAmount;
	}
	return total;
}
