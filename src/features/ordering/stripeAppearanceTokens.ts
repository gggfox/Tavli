/**
 * Literal colour values for the Stripe Elements iframe.
 *
 * This is the one place in the app where raw hex is legitimate: Elements
 * renders in a cross-origin iframe, so it cannot read our CSS custom
 * properties — `var(--bg-elevated)` resolves to nothing in there. Stripe's
 * `Appearance.variables` only accepts concrete colour strings.
 *
 * These values are transcriptions of `src/global/styles/theme.css`, kept in
 * one map so a theme change has a single place to follow rather than a dozen
 * hexes scattered through the checkout component. The keys name the token
 * they mirror; if you change the token, change it here.
 */
import type { Appearance } from "@stripe/stripe-js";
import { deriveBrandTokens } from "convex/_shared/brandColor";

export interface StripeThemeTokens {
	/** `--btn-primary-bg` */
	readonly primary: string;
	/** `--bg-primary` (light) / `--bg-elevated` (dark) — the Elements surface */
	readonly background: string;
	/** `--text-primary` */
	readonly text: string;
	/** `--text-secondary` */
	readonly textSecondary: string;
	/** `--input-placeholder` */
	readonly textPlaceholder: string;
	/** `--accent-danger` */
	readonly danger: string;
}

export const STRIPE_LIGHT_TOKENS: StripeThemeTokens = {
	primary: "#2383e2",
	background: "#ffffff",
	text: "#37352f",
	textSecondary: "#787774",
	textPlaceholder: "#9b9a97",
	danger: "#e03e3e",
};

export const STRIPE_DARK_TOKENS: StripeThemeTokens = {
	primary: "#2383e2",
	background: "#252525",
	text: "#ffffffcf",
	textSecondary: "#9b9a97",
	textPlaceholder: "#5a5a5a",
	danger: "#eb5757",
};

/** Border radius shared with the app's `rounded-lg`. */
export const STRIPE_BORDER_RADIUS = "8px";

/**
 * Build the Elements appearance for one mode, tinted by the restaurant.
 *
 * Shared by both payment surfaces so checkout does not snap back to Tavli blue
 * mid-flow — a diner who has just tapped a brand-coloured "Pay" button should
 * not land on a form in someone else's colour.
 *
 * **Only `colorPrimary` moves.** The surface, text and danger colours stay on
 * the platform palette:
 *
 * - `colorBackground` has to keep matching the page the iframe is embedded in.
 *   A brand-tinted background would produce a card form floating on a slightly
 *   wrong shade, which reads as broken rather than as branded.
 * - `colorDanger` is semantic. "Your card was declined" in a restaurant's happy
 *   green is a validation message nobody reads as a problem.
 *
 * The brand colour is passed through the same {@link deriveBrandTokens}
 * derivation the rest of the app uses, per mode, so the button inside the
 * iframe carries the *contrast-adjusted* fill rather than the raw hex — the
 * navy that is invisible on the dark menu would be equally invisible here.
 */
export function buildStripeAppearance(
	brandColor: string | null | undefined,
	isDark: boolean
): Appearance {
	const base = isDark ? STRIPE_DARK_TOKENS : STRIPE_LIGHT_TOKENS;
	const derived = brandColor ? deriveBrandTokens(brandColor, isDark ? "dark" : "light") : null;
	const tokens: StripeThemeTokens = derived ? { ...base, primary: derived.bg } : base;

	return {
		theme: isDark ? "night" : "stripe",
		variables: {
			colorPrimary: tokens.primary,
			colorBackground: tokens.background,
			colorText: tokens.text,
			colorTextSecondary: tokens.textSecondary,
			colorTextPlaceholder: tokens.textPlaceholder,
			colorDanger: tokens.danger,
			borderRadius: STRIPE_BORDER_RADIUS,
		},
	};
}
