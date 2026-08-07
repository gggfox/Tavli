import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import { PLATFORM_APPLICATION_FEE_RATE } from "../constants";
import {
	buildLineRefundIdempotencyKey,
	buildRefundIdempotencyKey,
	computeLineRefundAmount,
	computeOrderRefundAmount,
} from "../orderRefundHelpers";

const PAYMENT_A = "pay_a" as Id<"payments">;
const ORDER_A = "ord_a" as Id<"orders">;
const ORDER_B = "ord_b" as Id<"orders">;
const ITEM_A = "item_a" as Id<"orderItems">;
const ITEM_B = "item_b" as Id<"orderItems">;

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

	describe("fee-inclusive payments (ADR 008)", () => {
		it("refunds the entire remaining balance — the diner's fee comes back too", () => {
			// Order 10000, charge 11200 (12% customer-borne fee). Clamping to the
			// order total would strand the 1200 fee on the charge forever.
			expect(
				computeOrderRefundAmount({
					orderTotalAmount: 10000,
					paymentAmount: 11200,
					paymentAmountRefunded: undefined,
					paymentSubtotalAmount: 10000,
				})
			).toEqual({ amount: 11200, isFullRefund: true });
		});

		it("refunds only what is left after earlier line refunds", () => {
			expect(
				computeOrderRefundAmount({
					orderTotalAmount: 10000,
					paymentAmount: 11200,
					paymentAmountRefunded: 3733,
					paymentSubtotalAmount: 10000,
				})
			).toEqual({ amount: 7467, isFullRefund: true });
		});

		it("returns zero when the payment is already fully refunded", () => {
			expect(
				computeOrderRefundAmount({
					orderTotalAmount: 10000,
					paymentAmount: 11200,
					paymentAmountRefunded: 11200,
					paymentSubtotalAmount: 10000,
				})
			).toEqual({ amount: 0, isFullRefund: false });
		});
	});
});

describe("buildLineRefundIdempotencyKey", () => {
	it("has the documented refund:<payment>:<orderItem> shape", () => {
		expect(buildLineRefundIdempotencyKey(PAYMENT_A, ITEM_A)).toBe(`refund:${PAYMENT_A}:${ITEM_A}`);
	});

	it("differs per line so two 86s on one payment are not replayed", () => {
		expect(buildLineRefundIdempotencyKey(PAYMENT_A, ITEM_A)).not.toBe(
			buildLineRefundIdempotencyKey(PAYMENT_A, ITEM_B)
		);
	});

	it("never collides with the whole-order key for the same payment", () => {
		// Convex ids are table-scoped, so an orderItems id is never an orders id.
		expect(buildLineRefundIdempotencyKey(PAYMENT_A, ITEM_A)).not.toBe(
			buildRefundIdempotencyKey(PAYMENT_A, ORDER_A)
		);
	});
});

describe("computeLineRefundAmount", () => {
	it("refunds the line plus its rounded fee share", () => {
		// 600 line at 12% → 600 + 72.
		expect(
			computeLineRefundAmount({
				lineTotal: 600,
				feeRate: PLATFORM_APPLICATION_FEE_RATE,
				paymentAmount: 1568,
				paymentAmountRefunded: undefined,
				isLastLiveLine: false,
			})
		).toBe(672);
	});

	it("sums to exactly the payment amount across a fully-86'd order", () => {
		// Three lines whose per-line fee rounding cannot land cleanly:
		// subtotal 10000 → charge 11200. The last live line sweeps the remainder,
		// so the residue documented in the go-live runbook is structurally zero.
		const paymentAmount = 11200;
		const first = computeLineRefundAmount({
			lineTotal: 3333,
			feeRate: PLATFORM_APPLICATION_FEE_RATE,
			paymentAmount,
			paymentAmountRefunded: 0,
			isLastLiveLine: false,
		});
		const second = computeLineRefundAmount({
			lineTotal: 3333,
			feeRate: PLATFORM_APPLICATION_FEE_RATE,
			paymentAmount,
			paymentAmountRefunded: first,
			isLastLiveLine: false,
		});
		const last = computeLineRefundAmount({
			lineTotal: 3334,
			feeRate: PLATFORM_APPLICATION_FEE_RATE,
			paymentAmount,
			paymentAmountRefunded: first + second,
			isLastLiveLine: true,
		});

		expect(first).toBe(3733); // 3333 + round(399.96)
		expect(second).toBe(3733);
		expect(first + second + last).toBe(paymentAmount);
	});

	it("clamps to the remaining balance when less is left than line + fee", () => {
		expect(
			computeLineRefundAmount({
				lineTotal: 5000,
				feeRate: PLATFORM_APPLICATION_FEE_RATE,
				paymentAmount: 11200,
				paymentAmountRefunded: 10500,
				isLastLiveLine: false,
			})
		).toBe(700);
	});

	it("returns the whole remaining balance for the last live line", () => {
		// Even when the line + fee would be far less — the remainder sweep.
		expect(
			computeLineRefundAmount({
				lineTotal: 100,
				feeRate: PLATFORM_APPLICATION_FEE_RATE,
				paymentAmount: 11200,
				paymentAmountRefunded: 6200,
				isLastLiveLine: true,
			})
		).toBe(5000);
	});

	it("never goes negative when more was refunded than charged", () => {
		expect(
			computeLineRefundAmount({
				lineTotal: 100,
				feeRate: PLATFORM_APPLICATION_FEE_RATE,
				paymentAmount: 1000,
				paymentAmountRefunded: 5000,
				isLastLiveLine: true,
			})
		).toBe(0);
	});
});
