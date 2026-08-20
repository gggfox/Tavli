import { OrdersKeys } from "@/global/i18n";
import { describe, expect, it } from "vitest";
import {
	ALL_STATUSES,
	collapseLegacyStatusFilters,
	DEFAULT_STATUS,
	isDashboardStatus,
	nextActionFor,
	orderPaymentBadge,
	STATUS_CONFIG,
} from "./statusConfig";

describe("collapseLegacyStatusFilters", () => {
	it("returns null while the legacy setting is unknown", () => {
		expect(collapseLegacyStatusFilters(null)).toBeNull();
	});

	it("picks the highest-priority member of the legacy array (backfill rule)", () => {
		expect(collapseLegacyStatusFilters(["ready", "served"])).toBe("ready");
		expect(collapseLegacyStatusFilters(["cancelled", "preparing", "served"])).toBe("preparing");
		expect(collapseLegacyStatusFilters(["served", "submitted"])).toBe("submitted");
	});

	it("falls back to the queue default for an explicitly empty legacy array", () => {
		expect(collapseLegacyStatusFilters([])).toBe(DEFAULT_STATUS);
		expect(DEFAULT_STATUS).toBe("submitted");
	});
});

describe("awaiting_payment status config (ADR 008)", () => {
	it("is a first-class dashboard status, ordered before the workflow states", () => {
		expect(isDashboardStatus("awaiting_payment")).toBe(true);
		expect(ALL_STATUSES[0]).toBe("awaiting_payment");
	});

	it("has no next-status action: only mark-paid-in-person and cancel apply", () => {
		expect(STATUS_CONFIG.awaiting_payment.next).toBeNull();
		expect(STATUS_CONFIG.awaiting_payment.nextLabelKey).toBeNull();
	});

	it("uses a distinct label key from submitted's 'Pending'", () => {
		expect(STATUS_CONFIG.awaiting_payment.labelKey).not.toBe(STATUS_CONFIG.submitted.labelKey);
	});
});

describe("nextActionFor (the frontend mirror of the backend transition table)", () => {
	it("offers nothing on an uncollected cash round by default (ADR 008)", () => {
		expect(nextActionFor("awaiting_payment", false)).toBeNull();
	});

	it("borrows submitted's action where cash orders are released immediately", () => {
		expect(nextActionFor("awaiting_payment", true)).toEqual({
			next: STATUS_CONFIG.submitted.next,
			nextLabelKey: STATUS_CONFIG.submitted.nextLabelKey,
		});
	});

	it("leaves every other status alone, whichever way the policy is set", () => {
		for (const status of ALL_STATUSES.filter((s) => s !== "awaiting_payment")) {
			expect(nextActionFor(status, true)).toEqual(nextActionFor(status, false));
		}
		expect(nextActionFor("served", true)).toBeNull();
		expect(nextActionFor("preparing", false)?.next).toBe("ready");
	});
});

describe("orderPaymentBadge", () => {
	it("marks a round that owes cash 'to collect' at every status it reaches", () => {
		for (const status of ["awaiting_payment", "submitted", "preparing", "ready", "served"]) {
			expect(orderPaymentBadge({ status, awaitingPaymentAt: 1_000 })?.labelKey).toBe(
				OrdersKeys.PAYMENT_TO_COLLECT
			);
		}
	});

	it("says so even when the cash round carries no paymentState at all", () => {
		// `requestPayInPerson` writes none, so a paymentState lookup alone
		// would render nothing on exactly the card that needs the sticker.
		expect(orderPaymentBadge({ status: "preparing", awaitingPaymentAt: 1_000 })).toBeDefined();
	});

	it("drops the badge once the cash is collected", () => {
		expect(
			orderPaymentBadge({
				status: "preparing",
				awaitingPaymentAt: 1_000,
				paidAt: 2_000,
				paymentState: "paid",
			})?.labelKey
		).toBe(OrdersKeys.CARD_PAID);
	});

	it("still surfaces the states that predate the cash badge", () => {
		expect(orderPaymentBadge({ status: "cancelled", paymentState: "refund_failed" })?.tone).toBe(
			"danger"
		);
		expect(orderPaymentBadge({ status: "submitted" })).toBeUndefined();
		// A card charge mid-flight is nothing staff can act on.
		expect(orderPaymentBadge({ status: "submitted", paymentState: "processing" })).toBeUndefined();
	});
});
