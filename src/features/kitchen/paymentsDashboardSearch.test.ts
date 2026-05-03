/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown */
import { describe, expect, it } from "vitest";
import {
	clampPaymentsSearchQuery,
	PAYMENTS_SEARCH_QUERY_MAX_LEN,
	parsePaymentsPeriod,
	validatePaymentsSearch,
} from "./paymentsDashboardSearch";

describe("parsePaymentsPeriod", () => {
	it("accepts valid periods", () => {
		expect(parsePaymentsPeriod("month")).toBe("month");
		expect(parsePaymentsPeriod("all")).toBe("all");
	});

	it("rejects invalid values", () => {
		expect(parsePaymentsPeriod("invalid")).toBeUndefined();
		expect(parsePaymentsPeriod("")).toBeUndefined();
		expect(parsePaymentsPeriod(1)).toBeUndefined();
		expect(parsePaymentsPeriod(null)).toBeUndefined();
	});
});

describe("clampPaymentsSearchQuery", () => {
	it("trims and returns undefined for blank", () => {
		expect(clampPaymentsSearchQuery("   ")).toBeUndefined();
		expect(clampPaymentsSearchQuery("")).toBeUndefined();
	});

	it("clamps length", () => {
		const long = "a".repeat(PAYMENTS_SEARCH_QUERY_MAX_LEN + 50);
		const out = clampPaymentsSearchQuery(long);
		expect(out).toHaveLength(PAYMENTS_SEARCH_QUERY_MAX_LEN);
	});

	it("returns undefined for non-strings", () => {
		expect(clampPaymentsSearchQuery(undefined)).toBeUndefined();
		expect(clampPaymentsSearchQuery({})).toBeUndefined();
	});
});

describe("validatePaymentsSearch", () => {
	it("coerces known keys and drops invalid period", () => {
		expect(validatePaymentsSearch({ period: "week", q: "  tip  " })).toEqual({
			period: "week",
			q: "tip",
		});
	});

	it("strips invalid period and blank q to undefined fields", () => {
		expect(validatePaymentsSearch({ period: "nope", q: "  " })).toEqual({
			period: undefined,
			q: undefined,
		});
	});
});
