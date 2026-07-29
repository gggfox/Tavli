import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import { buildRefundIdempotencyKey, computeOrderRefundAmount } from "../orderRefundHelpers";

const PAYMENT_A = "pay_a" as Id<"payments">;
const ORDER_A = "ord_a" as Id<"orders">;
const ORDER_B = "ord_b" as Id<"orders">;

describe("buildRefundIdempotencyKey", () => {
	it("differs per order so a second refund on the same tab is not replayed", () => {
		// The bug this guards: keyed on the payment alone, Stripe replays the
		// first refund's response for 24h and the second order's refund silently
		// moves no money.
		expect(buildRefundIdempotencyKey(PAYMENT_A, ORDER_A)).not.toBe(
			buildRefundIdempotencyKey(PAYMENT_A, ORDER_B)
		);
	});

	it("is stable for the same payment/order so a retry de-duplicates", () => {
		expect(buildRefundIdempotencyKey(PAYMENT_A, ORDER_A)).toBe(
			buildRefundIdempotencyKey(PAYMENT_A, ORDER_A)
		);
	});

	it("stays within Stripe's 255-character idempotency key limit", () => {
		// Convex ids are ~32 chars; this is comfortably short, but the assertion
		// documents the constraint if the key format ever grows.
		expect(buildRefundIdempotencyKey(PAYMENT_A, ORDER_A).length).toBeLessThan(255);
	});
});

describe("computeOrderRefundAmount", () => {
	it("refunds the order's own total out of a larger tab", () => {
		expect(
			computeOrderRefundAmount({
				orderTotalAmount: 4000,
				paymentAmount: 11000,
				paymentAmountRefunded: undefined,
			})
		).toEqual({ amount: 4000, isFullRefund: false });
	});

	it("treats an order that is the whole charge as a full refund", () => {
		// Legacy per-order payments land here, and the caller omits `amount`
		// entirely so the Stripe call matches the pre-partial-refund shape.
		expect(
			computeOrderRefundAmount({
				orderTotalAmount: 2400,
				paymentAmount: 2400,
				paymentAmountRefunded: undefined,
			})
		).toEqual({ amount: 2400, isFullRefund: true });
	});

	it("clamps to the remaining balance when part of the tab is already refunded", () => {
		// Stripe rejects a refund for more than is left on the charge.
		expect(
			computeOrderRefundAmount({
				orderTotalAmount: 4000,
				paymentAmount: 11000,
				paymentAmountRefunded: 9000,
			})
		).toEqual({ amount: 2000, isFullRefund: true });
	});

	it("returns zero when the payment is already fully refunded", () => {
		expect(
			computeOrderRefundAmount({
				orderTotalAmount: 4000,
				paymentAmount: 11000,
				paymentAmountRefunded: 11000,
			})
		).toEqual({ amount: 0, isFullRefund: false });
	});

	it("never returns a negative amount when more was refunded than charged", () => {
		expect(
			computeOrderRefundAmount({
				orderTotalAmount: 4000,
				paymentAmount: 1000,
				paymentAmountRefunded: 5000,
			})
		).toEqual({ amount: 0, isFullRefund: false });
	});

	it("excludes the tip: refunding every order leaves the tip with the server", () => {
		// Tab of 10000 subtotal + 1000 tip, split across two orders.
		const first = computeOrderRefundAmount({
			orderTotalAmount: 6000,
			paymentAmount: 11000,
			paymentAmountRefunded: 0,
		});
		const second = computeOrderRefundAmount({
			orderTotalAmount: 4000,
			paymentAmount: 11000,
			paymentAmountRefunded: first.amount,
		});

		expect(first.amount + second.amount).toBe(10000);
		// Neither is a "full" refund, so the payment settles at `partial` and the
		// 1000 tip is never clawed back. That is the intended behaviour.
		expect(second.isFullRefund).toBe(false);
	});
});
