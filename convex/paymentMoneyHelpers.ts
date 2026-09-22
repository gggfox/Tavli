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
 * **Partial refunds are out of scope here.** These helpers report gross money
 * in; no aggregate has ever netted `amountRefunded` out of revenue and doing so
 * silently would restate history a second time.
 *
 * **Dispute recovery is its own line, never a deduction from revenue**
 * (TAVLI-102). When a lost chargeback is being repaid out of later orders, the
 * order still sold what it sold — `restaurantRevenue` is unchanged — and the
 * withheld amount appears as `disputeRecovery`, with `settledToRestaurant`
 * showing what actually reached the bank. That is the whole point: a
 * settlement figure that differs from a sales figure has to differ visibly, or
 * the next person to reconcile a short deposit has no line to point at.
 *
 * **A FULLY refunded row is not revenue** (TAVLI-104). That is not a netting
 * rule, it is the same status question asked properly: the money came and went,
 * and the restaurant sold nothing. It was survivable to count them while a full
 * refund only happened when a human cancelled an order — now the webhook
 * refunds a charge it cannot apply automatically, and the diner pays again for
 * the same food. Counting both is the same sale twice.
 */
import { PAYMENT_KIND, PAYMENT_REFUND_STATUS, PAYMENT_STATUS, SETTLED_BY } from "./constants";
import type { PaymentKind, PaymentRefundStatus, PaymentStatus, SettledBy } from "./constants";

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
	/** Withheld from the transfer to repay a lost dispute (TAVLI-102). */
	disputeRecoveryAmount?: number;
	/** Set once the ledger was actually drawn down — i.e. the charge settled. */
	disputeRecoveryAppliedAt?: number;
	/** Given back to the ledger because this payment was refunded. */
	disputeRecoveryRestored?: number;
	/** Absent on rows (and fixtures) that predate the field; treated as `none`. */
	refundStatus?: PaymentRefundStatus;
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
	/**
	 * Withheld from this row's transfer to repay a lost dispute (TAVLI-102).
	 * Zero on every row that carried no deduction, which is almost all of them.
	 */
	disputeRecovery: number;
	/**
	 * What actually reached the connected account: `netToRestaurant` minus the
	 * recovery. `null` wherever `netToRestaurant` is.
	 *
	 * **This is a settlement figure, not a sales figure**, and the two differ on
	 * purpose. The order sold what it sold; the recovery is the repayment of an
	 * older chargeback and belongs on its own line, so a restaurant reconciling
	 * a short bank deposit can see exactly which number moved and why. Netting
	 * it out of revenue instead would restate the sale.
	 */
	settledToRestaurant: number | null;
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
	const netToRestaurant = serviceFee === null ? null : restaurantRevenue + tip;
	const disputeRecovery = disputeRecoveryFromPayment(payment);

	return {
		chargedToDiner: payment.amount,
		restaurantRevenue,
		serviceFee,
		tip,
		netToRestaurant,
		disputeRecovery,
		settledToRestaurant: netToRestaurant === null ? null : netToRestaurant - disputeRecovery,
	};
}

/**
 * Dispute recovery actually withheld from one payment row (TAVLI-102).
 *
 * Counted only once the draw-down ran (`disputeRecoveryAppliedAt`), which
 * happens when the charge settles. A row that was priced with a deduction and
 * then failed or was superseded moved no money at all, and reporting its
 * intended deduction would show a restaurant a withholding that never happened.
 * The same rule nets out `disputeRecoveryRestored`: a refunded charge gave the
 * debt back to the ledger, so nothing was recovered from it either.
 */
export function disputeRecoveryFromPayment(payment: PaymentMoneyRow): number {
	if (payment.disputeRecoveryAppliedAt === undefined) return 0;
	// Net of anything a refund gave back: refunding the charge returns the
	// diner's money out of the platform balance and reverses only the already
	// -shortened transfer, so Tavli recovered nothing and the report must not
	// claim it did.
	const applied = payment.disputeRecoveryAmount ?? 0;
	return Math.max(0, applied - (payment.disputeRecoveryRestored ?? 0));
}

/** Σ {@link disputeRecoveryFromPayment} over a payment set. */
export function sumDisputeRecoveryFromPayments(payments: ReadonlyArray<PaymentMoneyRow>): number {
	let total = 0;
	for (const payment of payments) total += disputeRecoveryFromPayment(payment);
	return total;
}

/**
 * Restaurant revenue (food only — not Tavli's cut, not tips) contributed by
 * one payment row. Returns 0 for anything that is not a succeeded charge.
 */
export function restaurantRevenueFromPayment(payment: PaymentMoneyRow): number {
	if (!countsAsSettledMoney(payment)) return 0;
	return paymentMoneyBreakdown(payment).restaurantRevenue;
}

/**
 * Did this row leave money with the restaurant?
 *
 * `succeeded` is necessary and — since TAVLI-104 — no longer sufficient. A
 * charge the webhook could not apply to its order is marked `succeeded`
 * (Stripe really did collect) and refunded in full moments later, and the diner
 * then pays again. Counting the refunded row books that sale twice.
 *
 * Only a FULL refund disqualifies a row. A partial one (a single line removed
 * from a paid order) leaves real money behind, and netting it out here would
 * restate every historical figure — see the module comment.
 */
function countsAsSettledMoney(payment: PaymentMoneyRow): boolean {
	if (payment.status !== PAYMENT_STATUS.SUCCEEDED) return false;
	return payment.refundStatus !== PAYMENT_REFUND_STATUS.SUCCEEDED;
}

/**
 * Tip money contributed by one payment row: the whole amount of a
 * `kind: "tip"` row, or the `gratuityAmount` folded into a legacy tab
 * settlement. Returns 0 for anything that is not a succeeded charge.
 */
export function tipFromPayment(payment: PaymentMoneyRow): number {
	if (!countsAsSettledMoney(payment)) return 0;
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
