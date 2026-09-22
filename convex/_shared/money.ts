/**
 * Money formatting, with no dependencies.
 *
 * Amounts are stored as integer cents everywhere in Tavli. Turning them into
 * something a human reads used to live in `convex/exportHelpers.ts`, which
 * imports SheetJS — fine for the export actions, heavy for a mutation that only
 * needs to put two amounts into an operator alert's `messageParams` (TAVLI-104).
 * So the formatter moved here and `exportHelpers` re-exports it; there is still
 * exactly one implementation.
 */

/**
 * Integer cents as a plain decimal string: `1234` → `"12.34"`, `-5` → `"-0.05"`.
 *
 * No currency symbol and no locale grouping — callers append the currency code
 * themselves, and the operator-facing surfaces that use this (alerts, emails,
 * spreadsheets) render the same string in both languages.
 *
 * `null`/`undefined`/non-finite become `""` rather than `"NaN"`: an absent
 * amount should read as absent.
 */
export function formatMoneyCents(cents: number | undefined | null): string {
	if (cents == null || !Number.isFinite(cents)) return "";
	const sign = cents < 0 ? "-" : "";
	const abs = Math.abs(cents);
	const whole = Math.trunc(abs / 100);
	const frac = abs % 100;
	return `${sign}${whole}.${String(frac).padStart(2, "0")}`;
}
