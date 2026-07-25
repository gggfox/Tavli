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
