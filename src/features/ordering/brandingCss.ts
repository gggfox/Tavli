/**
 * Emit the brand token overrides injected into `/r/` pages (TAVLI-97, ADR 009).
 *
 * ## Why `:root` and not a wrapper `<div>`
 *
 * `theme.css` bridges its raw tokens into Tailwind through an `@theme` block:
 *
 *     @theme { --color-primary: var(--btn-primary-bg); }
 *
 * which Tailwind compiles to a declaration **on `:root`**. A custom property
 * substitutes on the element that carries the declaration, so `--color-primary`
 * resolves `var(--btn-primary-bg)` against `:root` — not against whatever
 * element is being painted.
 *
 * Override `--btn-primary-bg` on a wrapper and you retint every inline
 * `var(--btn-primary-bg)` style and every `hover-btn-primary` utility, because
 * those read the property where they are used. But `bg-primary`, `text-primary`
 * and friends compile to `var(--color-primary)`, which was already resolved at
 * `:root` against the *platform* blue. The result is a page that is roughly 70%
 * branded, with no error anywhere and no obvious pattern to which parts missed.
 *
 * So the styles go at `:root`, and the diner's mode is handled with
 * `:root:not(.dark)` / `:root.dark` because the server cannot know which one
 * the browser will apply.
 *
 * ## What is deliberately not overridden
 *
 * - `--color-primary` and the other `@theme` aliases. They already point at the
 *   raw tokens; setting both would give two sources of truth that drift.
 * - `--accent-*` and `--station-*`. Order status is *semantic* colour: green
 *   means ready, amber means waiting. A green-branded restaurant must not
 *   repaint "waiting" as "ready".
 */
import {
	deriveBrandTokens,
	normalizeBrandColor,
	type BrandTokens,
} from "convex/_shared/brandColor";

/** The branding shape the loader hands to `head()`. */
export interface BrandingCssInput {
	color?: string;
	fontStack?: string;
}

/**
 * Escape a value bound for a CSS declaration.
 *
 * Belt to the braces already fastened upstream: the colour is normalized on
 * write and re-normalized on read, and the font stack comes from a closed
 * registry, so nothing hostile should reach here. But this is the one place a
 * restaurant-controlled string becomes *executable stylesheet text* on an
 * anonymous page, and "should" is doing a lot of work in that sentence. A
 * `}` here would close the rule and let everything after it be authored by
 * whoever set the value.
 */
function cssSafe(value: string): string | null {
	// Anything that could terminate a declaration, open a new rule, start a
	// comment, or introduce a URL fetch.
	if (/[<>{}();@\\]|\/\*|url\(/i.test(value)) return null;
	return value;
}

/** One `--token: value;` block body, or "" when nothing is safe to emit. */
function declarations(entries: readonly (readonly [string, string])[]): string {
	return entries
		.map(([token, value]) => {
			const safe = cssSafe(value);
			return safe === null ? "" : `${token}:${safe};`;
		})
		.join("");
}

function modeBlock(selector: string, tokens: BrandTokens): string {
	const body = declarations([
		["--btn-primary-bg", tokens.bg],
		["--btn-primary-hover", tokens.hover],
		["--btn-primary-text", tokens.text],
		// The focus ring is what makes this feature not *introduce* a bug: the
		// outline used to be drawn in `--btn-primary-bg`, which is now the
		// brand colour, so a focused primary button would ring itself.
		["--focus-ring", tokens.ring],
		// A focused input's border is the same "this is the brand" signal as a
		// button fill, and it is not covered by the button tokens.
		["--input-border-focus", tokens.bg],
	]);
	return body ? `${selector}{${body}}` : "";
}

/**
 * The full `<style>` body for one restaurant, or `""` when it has no branding.
 *
 * **Must be a pure function of its input.** TanStack re-runs `head()` on
 * hydration and does not set `suppressHydrationWarning` on `style` elements,
 * so anything non-deterministic here — a timestamp, a random id, a read of
 * `document` — produces a hydration mismatch on every diner page load.
 */
export function buildBrandingCss(branding: BrandingCssInput | null | undefined): string {
	if (!branding) return "";

	const blocks: string[] = [];

	// Mode-independent: a typeface is not a property of light vs dark.
	if (branding.fontStack) {
		const body = declarations([["--font-body", branding.fontStack]]);
		if (body) blocks.push(`:root{${body}}`);
	}

	const color = normalizeBrandColor(branding.color);
	if (color) {
		const light = deriveBrandTokens(color, "light");
		const dark = deriveBrandTokens(color, "dark");
		// `:root:not(.dark)` rather than a bare `:root` for the light case, so
		// the two blocks are symmetric and neither depends on source order to
		// win. The dark class is applied by the inline theme script before
		// first paint.
		if (light) blocks.push(modeBlock(":root:not(.dark)", light));
		if (dark) blocks.push(modeBlock(":root.dark", dark));
	}

	return blocks.filter(Boolean).join("");
}
