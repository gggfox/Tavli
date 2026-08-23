/**
 * Integer cents ↔ display strings.
 *
 * ## Why the formatter is pinned to `en-US` and not the active i18n locale
 *
 * Two reasons, both deliberate:
 *
 * 1. **SSR/hydration.** This is a plain function with no React or i18next
 *    context, called from ~40 components that render on the server (TanStack
 *    Start SSR) and again on the client. Reading the active language from the
 *    i18next singleton here would resolve against a module-level instance
 *    shared by every in-flight SSR request, so a figure could render with one
 *    request's locale and hydrate with another's — a mismatch that React
 *    silently patches over and QA never reproduces. Threading the locale
 *    through every call site is the only safe way to make this locale-aware,
 *    and that is a bigger change than the grouping bug being fixed here.
 * 2. **It would not change the digits anyway.** The app ships exactly two
 *    locales, `en` (en-US) and `es` (Mexican Spanish), and both group with `,`
 *    and separate decimals with `.` — `2,000.00` either way. `Intl` resolves a
 *    bare `"es"` to es-ES (`2.000,00`), which is the *wrong* convention for
 *    this product's market, so "locale-aware" would actively regress Spanish.
 *
 * The **currency symbol is not this module's job** either: `restaurants.currency`
 * is per-restaurant (MXN by default, but USD/EUR/GBP are selectable), while every
 * call site prepends a literal `$`. Emitting a symbol here would double it. Real
 * per-restaurant currency rendering is a separate change that has to reach those
 * call sites; this module only guarantees the *number* is readable.
 */

/**
 * Grouped, fixed-2-decimals number formatting. Constructed once — `Intl`
 * formatter construction is the expensive part, and this runs per price cell.
 */
const AMOUNT_FORMATTER = new Intl.NumberFormat("en-US", {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

/**
 * Formats an integer cents value for **display** (e.g. `200000` → `"2,000.00"`).
 * Callers supply the currency symbol.
 */
export function formatCents(cents: number): string {
	return AMOUNT_FORMATTER.format(cents / 100);
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
