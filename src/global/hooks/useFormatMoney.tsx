import { currencySymbol, formatMoney } from "@/global/utils/money";
import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

/**
 * The currency the amounts in a subtree are denominated in — the restaurant's
 * `currency`.
 *
 * ## Why a context and not a prop
 *
 * Money is rendered by ~30 leaf components (price tags, cart lines, kitchen
 * cards, payment rows) that all sit under exactly one restaurant: the diner
 * tree under `/r/$slug`, or the staff shell's selected restaurant. Threading a
 * `currency` prop through every intermediate component would touch each one
 * for a value that never varies inside the tree. So each tree publishes it
 * once — `CustomerLayout` from `restaurants.getBySlug` (already prefetched by
 * the branding loader, so no extra round-trip) and `StaffLayout` from
 * `useRestaurant()` — and leaves read it here.
 *
 * Outside any provider (unit tests, a component rendered standalone) the value
 * is `null` and `formatMoney` falls back to `DEFAULT_DISPLAY_CURRENCY`.
 */
const MoneyCurrencyContext = createContext<string | null>(null);

export function MoneyCurrencyProvider({
	currency,
	children,
}: Readonly<{ currency: string | null | undefined; children: ReactNode }>) {
	return (
		<MoneyCurrencyContext.Provider value={currency || null}>
			{children}
		</MoneyCurrencyContext.Provider>
	);
}

/**
 * Returns a formatter for integer minor-unit amounts in the current language:
 * `const formatMoney = useFormatMoney(); formatMoney(order.totalAmount)` →
 * `"$123.45"`.
 *
 * Currency precedence: the call's own `currency` argument (a record that
 * carries its own, such as a Stripe payout), then this hook's `currency`
 * (a platform amount pinned to `PLATFORM_SUBSCRIPTION_CURRENCY`), then the
 * surrounding {@link MoneyCurrencyProvider}, then the default.
 *
 * The returned function is stable until the language or currency changes, so
 * it can sit in a `useMemo` dependency list (the payments ledger columns).
 */
export function useFormatMoney(
	currency?: string | null
): (minorUnits: number, currencyOverride?: string | null) => string {
	const { i18n } = useTranslation();
	const contextCurrency = useContext(MoneyCurrencyContext);
	// Optional-chained: several suites mock `useTranslation` with `t` only.
	const language = i18n?.language;
	const resolved = currency || contextCurrency;
	return useCallback(
		(minorUnits: number, currencyOverride?: string | null) =>
			formatMoney(minorUnits, currencyOverride || resolved, language),
		[resolved, language]
	);
}

/**
 * The surrounding restaurant's currency symbol, for a price input's `$`-style
 * adornment. Same precedence as {@link useFormatMoney}.
 */
export function useCurrencySymbol(currency?: string | null): string {
	const { i18n } = useTranslation();
	const contextCurrency = useContext(MoneyCurrencyContext);
	return currencySymbol(currency || contextCurrency, i18n?.language);
}
