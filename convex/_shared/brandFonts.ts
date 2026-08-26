/**
 * The curated brand-font shortlist (TAVLI-88, ADR 009).
 *
 * **A closed set, not arbitrary Google Fonts.** A manager-controlled family
 * name would flow into an SSR'd `<style>` and a `<link rel="preload">` on an
 * anonymous page — an out-of-bound fetch fired from every diner's phone, with
 * the restaurant choosing the host. These three are self-hosted from
 * `public/fonts/`, so the only origin a diner's browser talks to is ours.
 *
 * **Zero imports**, like `brandColor.ts` beside it, because this registry is
 * the single source for four consumers that must agree exactly:
 *   1. `convex/schema.ts` — freezes the ids into a `v.union`,
 *   2. the `@font-face` block in `src/global/styles/fonts.css`,
 *   3. the `<link rel="preload">` href emitted during SSR,
 *   4. the settings font picker.
 * Two of those are a stylesheet and a preload for the *same file*; a registry
 * that fed only one would preload a URL nothing uses and leave the face that
 * is used to be discovered late — the exact stall preloading exists to avoid.
 *
 * ## Why these three
 *
 * A restaurant picking a typeface is picking a personality, so the shortlist
 * has to span more than one. Inter is the neutral workhorse, Fraunces the
 * serif with warmth for a place that wants to read as established, Space
 * Grotesk the geometric option for somewhere modern. All three are open
 * licensed (OFL), ship latin + latin-ext — Spanish is half this product's
 * audience and `latin` alone drops á, é, í, ó, ú and ñ to a fallback face
 * mid-word — and subset under the 50 KB per-family budget.
 *
 * Deliberately excluded: condensed display faces. They look striking in a
 * specimen and turn a two-line menu-item name into three lines at the widths
 * a phone actually has.
 *
 * ## Subsets, and why Spanish needs no `latin-ext`
 *
 * Each family ships two files behind a `unicode-range`. The `latin` subset
 * covers `U+0000-00FF`, which includes the whole Latin-1 Supplement — á é í ó
 * ú ñ ü ¿ ¡ — so **both of this product's languages are served entirely by
 * `latin`**, and that is the only file a diner downloads. `latin-ext` carries
 * the Central- and Eastern-European characters that turn up in dish names, and
 * a browser fetches it only for a page that actually contains one.
 *
 * That split is what keeps the byte budget honest: per request a diner pays
 * for one `latin` file (47 / 36 / 22 KB), not for both.
 *
 * ## The metrics are measured, not guessed
 *
 * `font-display: swap` shows the fallback face first and swaps when the brand
 * face lands. Without metric overrides the two have different intrinsic
 * proportions, so the swap reflows every line of the menu — CLS on the one
 * screen the restaurant paid to make feel like theirs.
 *
 * The values below come from `scripts/measureFontMetrics.mjs`: vertical
 * metrics read out of the vendored woff2 itself, widths from
 * `@capsizecss/metrics` because `OS/2.xAvgCharWidth` is not comparable between
 * foundries (Inter's reports a figure 29% off its true weighted average, which
 * would scale the fallback wider than the real face and reflow *worse* than no
 * override). Do not hand-edit these; re-run the script if a font is replaced.
 */

/** Stable ids. Frozen into the schema — never renumber or rename. */
export const BRAND_FONT_IDS = ["inter", "fraunces", "spaceGrotesk"] as const;

export type BrandFontId = (typeof BRAND_FONT_IDS)[number];

/**
 * The fallback stack every brand face is metric-matched against, and the value
 * `--font-body` holds when a restaurant has chosen no font. Kept byte-identical
 * to the stack `base.css` shipped before this feature so an unbranded page
 * renders exactly as it did.
 */
export const SYSTEM_FONT_STACK =
	'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif, "Segoe UI Emoji", "Segoe UI Symbol"';

/**
 * Metric overrides that make the fallback occupy the same space as the real
 * face, so `font-display: swap` swaps glyphs without moving lines.
 * Percentages, written as CSS descriptor strings.
 */
export interface FontFallbackMetrics {
	/** `size-adjust` on the `@font-face` fallback. */
	sizeAdjust: string;
	/** `ascent-override`. */
	ascentOverride: string;
	/** `descent-override`. */
	descentOverride: string;
	/** `line-gap-override`. */
	lineGapOverride: string;
}

export interface BrandFont {
	id: BrandFontId;
	/** Shown in the settings picker. */
	label: string;
	/** The `font-family` name declared by `@font-face`. */
	family: string;
	/**
	 * The two subset files under `public/fonts/`, woff2 only — every target
	 * browser has supported woff2 for years, and a woff fallback doubles the
	 * bytes served to nobody.
	 */
	files: {
		/** Served to every diner. Carries all of English and Spanish. */
		latin: string;
		/** Fetched only when the page contains a character outside Latin-1. */
		latinExt: string;
	};
	/** Weights packed into the variable font, as a CSS `font-weight` range. */
	weightRange: string;
	/** Measured against {@link SYSTEM_FONT_STACK}. */
	metrics: FontFallbackMetrics;
	/**
	 * Full stack for `--font-body`: real face, then the metric-matched fallback
	 * declared in `fonts.css`, then the platform stack.
	 *
	 * The middle entry is the one that does the work and the one it is easiest
	 * to leave out. `@font-face { font-family: "Inter Brand Fallback" }`
	 * defines a face; it has no effect on anything until something *names* it.
	 * Omit it here and the metrics are computed, committed, documented — and
	 * completely inert, with the swap reflowing exactly as it would have with
	 * no overrides at all.
	 */
	stack: string;
}

export const BRAND_FONTS: Readonly<Record<BrandFontId, BrandFont>> = {
	inter: {
		id: "inter",
		label: "Inter",
		family: "Inter Brand",
		files: { latin: "inter-latin.woff2", latinExt: "inter-latin-ext.woff2" },
		weightRange: "400 700",
		metrics: {
			sizeAdjust: "107.12%",
			ascentOverride: "90.44%",
			descentOverride: "22.52%",
			lineGapOverride: "0.00%",
		},
		stack: `"Inter Brand", "Inter Brand Fallback", ${SYSTEM_FONT_STACK}`,
	},
	fraunces: {
		id: "fraunces",
		label: "Fraunces",
		family: "Fraunces Brand",
		files: { latin: "fraunces-latin.woff2", latinExt: "fraunces-latin-ext.woff2" },
		weightRange: "400 700",
		metrics: {
			sizeAdjust: "105.20%",
			ascentOverride: "92.96%",
			descentOverride: "24.24%",
			lineGapOverride: "0.00%",
		},
		// A serif falls back to a serif. Dropping to the sans system stack
		// would make the swap a change of *category*, which reads as the page
		// breaking rather than as the font arriving.
		stack: `"Fraunces Brand", "Fraunces Brand Fallback", Georgia, "Times New Roman", serif`,
	},
	spaceGrotesk: {
		id: "spaceGrotesk",
		label: "Space Grotesk",
		family: "Space Grotesk Brand",
		files: { latin: "space-grotesk-latin.woff2", latinExt: "space-grotesk-latin-ext.woff2" },
		weightRange: "400 700",
		metrics: {
			sizeAdjust: "109.69%",
			ascentOverride: "89.71%",
			descentOverride: "26.62%",
			lineGapOverride: "0.00%",
		},
		stack: `"Space Grotesk Brand", "Space Grotesk Brand Fallback", ${SYSTEM_FONT_STACK}`,
	},
};

/**
 * Public path of the file to **preload** for a chosen font.
 *
 * Always the `latin` subset: it is the one every English or Spanish page needs,
 * and preload takes a single URL with no way to express "whichever subset this
 * page turns out to require". `latin-ext` is deliberately left to normal
 * discovery — preloading a file most pages never request would spend the
 * connection preload exists to save.
 */
export function brandFontPreloadHref(id: BrandFontId): string {
	return `/fonts/${BRAND_FONTS[id].files.latin}`;
}

/**
 * Narrow an arbitrary stored value to a known font id.
 *
 * The schema's `v.union` already rejects unknown ids on write, but rows
 * predating this feature carry `undefined` and a future id removal would
 * strand rows carrying the old one. Both cases resolve to `null` — no font
 * chosen — rather than throwing on a diner-facing page.
 */
export function resolveBrandFontId(value: string | null | undefined): BrandFontId | null {
	if (typeof value !== "string") return null;
	return (BRAND_FONT_IDS as readonly string[]).includes(value) ? (value as BrandFontId) : null;
}

/** The `--font-body` value for a chosen font, or the system stack when none. */
export function brandFontStack(value: string | null | undefined): string {
	const id = resolveBrandFontId(value);
	return id === null ? SYSTEM_FONT_STACK : BRAND_FONTS[id].stack;
}
