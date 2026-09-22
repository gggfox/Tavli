/**
 * Unit tests for the ADR 008 money-split rules shared by analytics, exports
 * and the payments ledger.
 */
import { describe, expect, it } from "vitest";
import { PAYMENT_KIND, PAYMENT_REFUND_STATUS, PAYMENT_STATUS, SETTLED_BY } from "./constants";
import {
	hasFeeBreakdown,
	isCashSettledOrder,
	paymentMoneyBreakdown,
	restaurantRevenueFromPayment,
	sumCashSettledOrderRevenue,
	sumRestaurantRevenueFromPayments,
	tipFromPayment,
	type PaymentMoneyRow,
} from "./paymentMoneyHelpers";

/** Post-pivot order charge: 10,000 subtotal + 1,200 customer-borne fee. */
const orderPayment: PaymentMoneyRow = {
	amount: 11200,
	subtotalAmount: 10000,
	feeAmount: 1200,
	kind: PAYMENT_KIND.ORDER,
	status: PAYMENT_STATUS.SUCCEEDED,
};

/** Post-visit tip: whole amount is gratuity, never a service fee. */
const tipPayment: PaymentMoneyRow = {
	amount: 2000,
	subtotalAmount: 0,
	feeAmount: 0,
	gratuityAmount: 2000,
	kind: PAYMENT_KIND.TIP,
	status: PAYMENT_STATUS.SUCCEEDED,
};

/** Pre-pivot tab settlement: no kind, no split, tip folded into `amount`. */
const legacyPayment: PaymentMoneyRow = {
	amount: 5500,
	gratuityAmount: 500,
	status: PAYMENT_STATUS.SUCCEEDED,
};

describe("paymentMoneyBreakdown", () => {
	it("splits a post-pivot order charge into food, fee and net", () => {
		expect(paymentMoneyBreakdown(orderPayment)).toEqual({
			chargedToDiner: 11200,
			restaurantRevenue: 10000,
			serviceFee: 1200,
			tip: 0,
			netToRestaurant: 10000,
		});
	});

	it("reports a tip as tip only — never as restaurant sales", () => {
		expect(paymentMoneyBreakdown(tipPayment)).toEqual({
			chargedToDiner: 2000,
			restaurantRevenue: 0,
			serviceFee: 0,
			tip: 2000,
			netToRestaurant: 2000,
		});
	});

	it("falls back to `amount` on legacy rows and reports no fee split", () => {
		expect(paymentMoneyBreakdown(legacyPayment)).toEqual({
			chargedToDiner: 5500,
			restaurantRevenue: 5500,
			serviceFee: null,
			tip: 500,
			netToRestaurant: null,
		});
	});

	it("distinguishes split-bearing rows from legacy rows", () => {
		expect(hasFeeBreakdown(orderPayment)).toBe(true);
		expect(hasFeeBreakdown(legacyPayment)).toBe(false);
	});
});

describe("restaurantRevenueFromPayment", () => {
	it("ignores anything that is not a succeeded charge", () => {
		for (const status of [
			PAYMENT_STATUS.PENDING,
			PAYMENT_STATUS.PROCESSING,
			PAYMENT_STATUS.FAILED,
			PAYMENT_STATUS.SUPERSEDED,
			PAYMENT_STATUS.CANCELLED,
		]) {
			expect(restaurantRevenueFromPayment({ ...orderPayment, status })).toBe(0);
		}
	});

	it("sums food value across mixed vintages, excluding fee and tips", () => {
		expect(sumRestaurantRevenueFromPayments([orderPayment, tipPayment, legacyPayment])).toBe(15500);
	});

	/**
	 * TAVLI-104. A charge the webhook cannot apply to its order is marked
	 * SUCCEEDED — Stripe really did collect — and refunded in full, and the diner
	 * then pays again for the same food. Counting the refunded row books that
	 * sale twice.
	 */
	it("ignores a fully refunded charge — the money came and went", () => {
		const refunded = { ...orderPayment, refundStatus: PAYMENT_REFUND_STATUS.SUCCEEDED };
		expect(restaurantRevenueFromPayment(refunded)).toBe(0);
		expect(tipFromPayment({ ...tipPayment, refundStatus: PAYMENT_REFUND_STATUS.SUCCEEDED })).toBe(
			0
		);
		// The order's real payment is the only one left standing.
		expect(sumRestaurantRevenueFromPayments([refunded, orderPayment])).toBe(10000);
	});

	it("still counts a partially refunded charge in full", () => {
		// One line removed from a paid order leaves real money behind, and netting
		// it out here would restate every historical figure — see the module note.
		expect(
			restaurantRevenueFromPayment({
				...orderPayment,
				refundStatus: PAYMENT_REFUND_STATUS.PARTIAL,
			})
		).toBe(10000);
		// As does a refund that was only requested, or that failed.
		for (const refundStatus of [
			PAYMENT_REFUND_STATUS.NONE,
			PAYMENT_REFUND_STATUS.REQUESTED,
			PAYMENT_REFUND_STATUS.FAILED,
		]) {
			expect(restaurantRevenueFromPayment({ ...orderPayment, refundStatus })).toBe(10000);
		}
	});
});

describe("cash-settled orders", () => {
	it("recognises an order marked paid in person", () => {
		expect(isCashSettledOrder({ totalAmount: 3000, paidAt: 1, settledBy: SETTLED_BY.STAFF })).toBe(
			true
		);
	});

	it("excludes card orders and unpaid cash-intent orders", () => {
		expect(isCashSettledOrder({ totalAmount: 3000, paidAt: 1, settledBy: SETTLED_BY.STRIPE })).toBe(
			false
		);
		// Committed as `awaiting_payment` but not yet collected.
		expect(isCashSettledOrder({ totalAmount: 3000, settledBy: SETTLED_BY.STAFF })).toBe(false);
		// Pre-pivot tab-settled order: no `settledBy` on the order at all.
		expect(isCashSettledOrder({ totalAmount: 3000, paidAt: 1 })).toBe(false);
	});

	it("sums only the cash-settled orders", () => {
		expect(
			sumCashSettledOrderRevenue([
				{ totalAmount: 3000, paidAt: 1, settledBy: SETTLED_BY.STAFF },
				{ totalAmount: 9999, paidAt: 1, settledBy: SETTLED_BY.STRIPE },
				{ totalAmount: 700, paidAt: 2, settledBy: SETTLED_BY.STAFF },
			])
		).toBe(3700);
	});
});
