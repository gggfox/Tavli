/** URL search + validation for the admin payments dashboard. */

export const PAYMENTS_TIME_PERIODS = [
	"today",
	"week",
	"month",
	"quarter",
	"year",
	"all",
] as const;

export type PaymentsTimePeriod = (typeof PAYMENTS_TIME_PERIODS)[number];

const VALID_PERIODS = new Set<string>(PAYMENTS_TIME_PERIODS);

export const PAYMENTS_SEARCH_QUERY_MAX_LEN = 200;

export type PaymentsDashboardSearch = {
	readonly period?: PaymentsTimePeriod;
	readonly q?: string;
};

export function parsePaymentsPeriod(raw: unknown): PaymentsTimePeriod | undefined {
	if (typeof raw !== "string") return undefined;
	return VALID_PERIODS.has(raw) ? (raw as PaymentsTimePeriod) : undefined;
}

/** Returns `undefined` when empty after trim (omit from URL). */
export function clampPaymentsSearchQuery(raw: unknown): string | undefined {
	if (typeof raw !== "string") return undefined;
	const t = raw.trim();
	if (!t) return undefined;
	return t.length > PAYMENTS_SEARCH_QUERY_MAX_LEN
		? t.slice(0, PAYMENTS_SEARCH_QUERY_MAX_LEN)
		: t;
}

export function validatePaymentsSearch(search: Record<string, unknown>): PaymentsDashboardSearch {
	return {
		period: parsePaymentsPeriod(search.period),
		q: clampPaymentsSearchQuery(search.q),
	};
}
