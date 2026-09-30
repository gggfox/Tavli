/**
 * Integer minor units ↔ display strings.
 *
 * ## One money format, with the currency symbol
 *
 * Every amount a person reads goes through {@link formatMoney} (or its React
 * wrapper, `useFormatMoney`). It used to be `formatCents` plus a literal `$` at
 * ~35 call sites, with the payouts and disputes pages appending ` MXN` and the
 * team drawer printing `toFixed(2) MXN` — three spellings of the same number,
 * and a EUR restaurant shown in dollars. `restaurants.currency` is
 * per-restaurant (MXN by default, but USD/EUR/GBP are selectable), so the
 * symbol has to come from the data, never from the markup.
 *
 * ## Why the locale is es-MX / en-US and nothing else
 *
 * The app ships exactly two languages, `en` and `es` (Mexican Spanish).
 * {@link moneyLocale} is the one place they become a BCP-47 locale. `Intl`
 * resolves a bare `"es"` to es-ES (`2.000,00 €`), which is the *wrong*
 * convention for this product's market, so the language is never handed to
 * `Intl` directly.
 *
 * ## Why `narrowSymbol`
 *
 * With the default `currencyDisplay: "symbol"`, en-US renders MXN as `MX$` and
 * es-MX renders USD as `USD 2.00` — the same amount spelled differently per
 * language. `narrowSymbol` gives `$` / `€` / `£` / `¥` in **both** locales,
 * which also keeps the SSR pass and hydration byte-identical even if they
 * resolve different languages: for every currency the app offers, es-MX and
 * en-US produce the same string.
 */
import { normalizeLanguage } from "@/global/i18n/language";
import { Languages } from "@/global/i18n/keys/languages";

/**
 * Currency assumed when a caller has none to give (no restaurant selected yet,
 * a record without a currency). Matches the default a new restaurant is created
 * with; every live restaurant is MXN today.
 */
export const DEFAULT_DISPLAY_CURRENCY = "MXN";

/** The locale money is formatted in, per app language. */
export type MoneyLocale = "es-MX" | "en-US";

/**
 * Maps an app language (`en` / `es`, or any tag i18next hands back, such as
 * `es-MX`) onto the locale money is formatted in. Anything unrecognised is
 * English, matching `fallbackLng`.
 */
export function moneyLocale(language: string | null | undefined): MoneyLocale {
	return normalizeLanguage(language) === Languages.ES ? "es-MX" : "en-US";
}

/**
 * A cached formatter plus the currency's minor-unit exponent, or `null` for a
 * currency code `Intl` rejects (so the rejection is remembered, not retried
 * per render).
 */
type MoneyFormatter = { format: Intl.NumberFormat; fractionDigits: number } | null;

/**
 * Keyed by `locale|CURRENCY`. `Intl` construction is the expensive part and
 * this runs per price cell; the key space is two locales times the handful of
 * currencies in the data, so it needs no bound.
 */
const FORMATTERS = new Map<string, MoneyFormatter>();

function getFormatter(locale: MoneyLocale, currency: string): MoneyFormatter {
	const key = `${locale}|${currency}`;
	const cached = FORMATTERS.get(key);
	if (cached !== undefined) return cached;

	let entry: MoneyFormatter;
	try {
		const format = new Intl.NumberFormat(locale, {
			style: "currency",
			currency,
			currencyDisplay: "narrowSymbol",
		});
		// `Intl` defaults the fraction digits to the currency's ISO 4217 minor
		// unit (2 for MXN, 0 for JPY), which is also how Stripe denominates it.
		entry = { format, fractionDigits: format.resolvedOptions().maximumFractionDigits ?? 2 };
	} catch {
		// `RangeError: Invalid currency code` — a malformed value in the data
		// must degrade to a readable number, never throw in render.
		entry = null;
	}
	FORMATTERS.set(key, entry);
	return entry;
}

/** Plain grouped number for the invalid-currency fallback (`1,234.50`). */
const FALLBACK_NUMBER = new Intl.NumberFormat("en-US", {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

/**
 * Formats an integer amount in the currency's **minor unit** (centavos, cents;
 * whole yen for JPY — the same unit Stripe and the schema store) for display,
 * symbol included: `formatMoney(200000, "MXN", "es")` → `"$2,000.00"`,
 * `formatMoney(-500, "EUR", "en")` → `"-€5.00"`, `formatMoney(1500, "JPY",
 * "en")` → `"¥1,500"`.
 *
 * - `currency` is an ISO 4217 code, any case (Stripe sends `mxn`). Missing or
 *   empty falls back to {@link DEFAULT_DISPLAY_CURRENCY}.
 * - `language` is the app language (`i18n.language`); see {@link moneyLocale}.
 * - A code `Intl` rejects renders as a grouped two-decimal number followed by
 *   the raw code (`"2,000.00 XX"`) instead of throwing.
 *
 * In components, prefer `useFormatMoney`, which supplies the language and the
 * surrounding restaurant's currency.
 */
export function formatMoney(
	minorUnits: number,
	currency: string | null | undefined,
	language: string | null | undefined
): string {
	const code = (currency?.trim() || DEFAULT_DISPLAY_CURRENCY).toUpperCase();
	const formatter = getFormatter(moneyLocale(language), code);
	if (!formatter) return `${FALLBACK_NUMBER.format(minorUnits / 100)} ${code}`;
	return formatter.format.format(minorUnits / 10 ** formatter.fractionDigits);
}

/**
 * The symbol {@link formatMoney} would print for `currency` (`$`, `€`, `¥`) —
 * for a price **input's** adornment, where the field holds the bare number.
 * Falls back to the upper-cased code for a currency `Intl` rejects.
 */
export function currencySymbol(
	currency: string | null | undefined,
	language: string | null | undefined
): string {
	const code = (currency?.trim() || DEFAULT_DISPLAY_CURRENCY).toUpperCase();
	const formatter = getFormatter(moneyLocale(language), code);
	return formatter?.format.formatToParts(0).find((p) => p.type === "currency")?.value ?? code;
}

/**
 * Formats an integer cents value as a bare number (e.g. `200000` →
 * `"2,000.00"`), with no currency symbol.
 *
 * @deprecated Use {@link formatMoney} / `useFormatMoney` for anything a person
 * reads — this one made every caller prepend a literal `$`, which is how a EUR
 * restaurant ended up priced in dollars. Kept only so an in-flight branch that
 * still imports it keeps compiling; nothing in `src/` calls it any more.
 */
export function formatCents(cents: number): string {
	return FALLBACK_NUMBER.format(cents / 100);
}

/**
 * Formats an integer cents value for an **editable input** (e.g. `200000` →
 * `"2000.00"`) — ungrouped, so what the field shows is exactly what a user
 * would type and {@link parseDollarsToCents} round-trips it losslessly.
 */
export function formatCentsInput(cents: number): string {
	return (cents / 100).toFixed(2);
}

/**
 * Parses a dollar string input to integer cents. Returns `NaN` if invalid.
 *
 * Group separators are stripped first so a value pasted from a display string
 * ("2,000.00") parses as 200000 rather than as `parseFloat("2,000.00") === 2`.
 */
export function parseDollarsToCents(input: string): number {
	return Math.round(Number.parseFloat(input.replace(/,/g, "")) * 100);
}
