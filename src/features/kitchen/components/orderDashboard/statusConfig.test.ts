import { describe, expect, it } from "vitest";
import {
	ALL_STATUSES,
	collapseLegacyStatusFilters,
	DEFAULT_STATUS,
	isDashboardStatus,
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
