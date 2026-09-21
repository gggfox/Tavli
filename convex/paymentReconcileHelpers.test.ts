import { describe, expect, it } from "vitest";
import {
	ORDER_PAYMENT_RECONCILE_ALERT_AGE_MS,
	ORDER_PAYMENT_RECONCILE_MIN_AGE_MS,
	OPERATOR_ALERT_SEVERITY,
	PAYMENT_KIND,
	TIP_PAYMENT_RECONCILE_ALERT_AGE_MS,
	TIP_PAYMENT_RECONCILE_MIN_AGE_MS,
} from "./constants";
import {
	decidePaymentReconciliation,
	stuckPaymentAlertSeverity,
	stuckPaymentReconcileAges,
	stuckPaymentSweepKind,
	STUCK_PAYMENT_SWEEP_KIND,
} from "./paymentReconcileHelpers";

const MINUTE = 60 * 1000;

describe("stuckPaymentSweepKind (TAVLI-106)", () => {
	it("sweeps a kind:order row as an order", () => {
		expect(stuckPaymentSweepKind({ kind: PAYMENT_KIND.ORDER })).toBe(
			STUCK_PAYMENT_SWEEP_KIND.ORDER
		);
	});

	it("sweeps a kind:tip row as a tip even though it carries a sessionId", () => {
		// The dispatch order that `failPaymentByKind` already depends on: a tip
		// row belongs to a session, so `sessionId` alone cannot mean "tab".
		expect(stuckPaymentSweepKind({ kind: PAYMENT_KIND.TIP, sessionId: "sessions:abc" })).toBe(
			STUCK_PAYMENT_SWEEP_KIND.TIP
		);
	});

	it("sweeps a legacy row with no kind and no sessionId as an order", () => {
		// Pre-pivot per-order payment. It has an orderId and settles through the
		// same `orders.confirmPayment` path a kind:order row does.
		expect(stuckPaymentSweepKind({})).toBe(STUCK_PAYMENT_SWEEP_KIND.ORDER);
	});

	it("leaves a legacy tab row to the tab sweep", () => {
		// No `kind` + a `sessionId` is the ONLY shape a tab payment has, and
		// `reconcileStuckTabPayments` owns it: it has to unlock the session too.
		expect(stuckPaymentSweepKind({ sessionId: "sessions:abc" })).toBeNull();
	});
});

describe("stuckPaymentReconcileAges (TAVLI-106)", () => {
	it("gives orders the short pair and tips the long pair", () => {
		expect(stuckPaymentReconcileAges(STUCK_PAYMENT_SWEEP_KIND.ORDER)).toEqual({
			minAgeMs: ORDER_PAYMENT_RECONCILE_MIN_AGE_MS,
			alertAgeMs: ORDER_PAYMENT_RECONCILE_ALERT_AGE_MS,
		});
		expect(stuckPaymentReconcileAges(STUCK_PAYMENT_SWEEP_KIND.TIP)).toEqual({
			minAgeMs: TIP_PAYMENT_RECONCILE_MIN_AGE_MS,
			alertAgeMs: TIP_PAYMENT_RECONCILE_ALERT_AGE_MS,
		});
	});
});

describe("decidePaymentReconciliation (TAVLI-106)", () => {
	it("settles a succeeded intent", () => {
		expect(
			decidePaymentReconciliation({
				paymentIntentStatus: "succeeded",
				ageMs: 6 * MINUTE,
				kind: STUCK_PAYMENT_SWEEP_KIND.ORDER,
			})
		).toBe("settle");
	});

	it("clears a canceled intent", () => {
		expect(
			decidePaymentReconciliation({
				paymentIntentStatus: "canceled",
				ageMs: 6 * MINUTE,
				kind: STUCK_PAYMENT_SWEEP_KIND.ORDER,
			})
		).toBe("clear");
	});

	it("clears an intent back at requires_payment_method — the diner abandoned the card sheet", () => {
		expect(
			decidePaymentReconciliation({
				paymentIntentStatus: "requires_payment_method",
				ageMs: 6 * MINUTE,
				kind: STUCK_PAYMENT_SWEEP_KIND.ORDER,
			})
		).toBe("clear");
		expect(
			decidePaymentReconciliation({
				paymentIntentStatus: "requires_payment_method",
				ageMs: 31 * MINUTE,
				kind: STUCK_PAYMENT_SWEEP_KIND.TIP,
			})
		).toBe("clear");
	});

	it.each(["processing", "requires_action", "requires_confirmation", "requires_capture"])(
		"waits on a %s intent under the alert age",
		(paymentIntentStatus) => {
			expect(
				decidePaymentReconciliation({
					paymentIntentStatus,
					ageMs: 6 * MINUTE,
					kind: STUCK_PAYMENT_SWEEP_KIND.ORDER,
				})
			).toBe("wait");
		}
	);

	it.each(["processing", "requires_action", "requires_confirmation", "requires_capture"])(
		"alerts on a %s intent past the alert age",
		(paymentIntentStatus) => {
			expect(
				decidePaymentReconciliation({
					paymentIntentStatus,
					ageMs: ORDER_PAYMENT_RECONCILE_ALERT_AGE_MS,
					kind: STUCK_PAYMENT_SWEEP_KIND.ORDER,
				})
			).toBe("alert");
		}
	);

	it("uses the tip thresholds for a tip row", () => {
		// 20 minutes is past an ORDER's alert age and nowhere near a tip's.
		expect(
			decidePaymentReconciliation({
				paymentIntentStatus: "processing",
				ageMs: 20 * MINUTE,
				kind: STUCK_PAYMENT_SWEEP_KIND.TIP,
			})
		).toBe("wait");
		expect(
			decidePaymentReconciliation({
				paymentIntentStatus: "processing",
				ageMs: TIP_PAYMENT_RECONCILE_ALERT_AGE_MS,
				kind: STUCK_PAYMENT_SWEEP_KIND.TIP,
			})
		).toBe("alert");
	});

	it("alerts on an unrecognised status immediately", () => {
		expect(
			decidePaymentReconciliation({
				paymentIntentStatus: "some_future_stripe_status",
				ageMs: 6 * MINUTE,
				kind: STUCK_PAYMENT_SWEEP_KIND.ORDER,
			})
		).toBe("alert");
	});
});

describe("stuckPaymentAlertSeverity (TAVLI-106)", () => {
	it("is severe for an order past the alert age — a diner is waiting for food", () => {
		expect(
			stuckPaymentAlertSeverity(
				STUCK_PAYMENT_SWEEP_KIND.ORDER,
				ORDER_PAYMENT_RECONCILE_ALERT_AGE_MS
			)
		).toBe(OPERATOR_ALERT_SEVERITY.SEVERE);
	});

	it("is a warning for an order that is only stuck on an unknown status", () => {
		expect(stuckPaymentAlertSeverity(STUCK_PAYMENT_SWEEP_KIND.ORDER, 6 * MINUTE)).toBe(
			OPERATOR_ALERT_SEVERITY.WARNING
		);
	});

	it("is a warning for a tip at any age — nobody is waiting on it", () => {
		expect(
			stuckPaymentAlertSeverity(STUCK_PAYMENT_SWEEP_KIND.TIP, TIP_PAYMENT_RECONCILE_ALERT_AGE_MS)
		).toBe(OPERATOR_ALERT_SEVERITY.WARNING);
	});
});
