/**
 * Brand-colour derivation (TAVLI-88, ADR 009).
 *
 * A restaurant stores **one** brand colour. Everything else the UI needs — the
 * hover shade, readable ink on the fill, the focus ring, and the per-mode
 * contrast adjustment — is derived here and never stored. A full palette
 * editor was rejected: it multiplies the combinations a restaurant can break,
 * and none of it is recoverable by a derivation.
 *
 * **Zero imports, on purpose.** Three callers need identical answers or they
 * disagree about what "readable" means:
 *   1. the SSR loader on `/r/$slug` (`src/`), which injects the tokens,
 *   2. the Stripe appearance builder (`src/`), so Checkout does not snap back
 *      to Tavli blue mid-flow,
 *   3. the receipt renderer (`convex/`), which runs in a Convex action.
 * Convex files may only import Convex files (see CLAUDE.md), so this module
 * lives here and stays dependency-free in both directions.
 *
 * Two rulings that produce working-looking code if ignored:
 *
 * - **Target the worst surface per mode, not `--bg-primary`.** A fill tuned to
 *   3.00:1 against `#ffffff` scores 2.65:1 on the `#f1f1ef` card that sits on
 *   top of it. The targets below are the darkest light surface and the
 *   lightest dark surface actually in `theme.css`.
 * - **Ink is chosen by comparing both ratios**, never by a precomputed
 *   luminance crossover. The tempting `0.1791` constant is derived for pure
 *   black; used against this theme's near-black it picks the worse option
 *   across a whole band of mid-tone brands.
 */

/** Canonical `#rrggbb`, lowercase. The only shape stored or emitted. */
export type HexColor = string;

export type BrandMode = "light" | "dark";

/**
 * Worst-case surface a brand fill can land on, per mode.
 *
 * Light: `--bg-tertiary` (`#f1f1ef`), the menu card — darker than the page, so
 * a fill that clears 3:1 here clears it on `--bg-primary` too. Dark:
 * `--bg-elevated` (`#252525`), the raised card — lighter than the page, same
 * argument inverted. Keep these in sync with `src/global/styles/theme.css`.
 */
export const WORST_SURFACE: Readonly<Record<BrandMode, HexColor>> = {
	light: "#f1f1ef",
	dark: "#252525",
};

/**
 * The two ink candidates for a label sitting on the brand fill. Not
 * `#000000`: this theme's darkest text is `#181818`, and deriving against a
 * black the UI never renders produces ink decisions that are wrong in the
 * middle of the range.
 */
const INK_LIGHT: HexColor = "#ffffff";
const INK_DARK: HexColor = "#181818";

/** WCAG AA for large/bold UI components against their background. */
const MIN_SURFACE_RATIO = 3;
/** WCAG AA for the button label against the brand fill. */
const MIN_LABEL_RATIO = 4.5;
/**
 * A focus ring must read against the surface it is drawn on. Separation from
 * the button fill is a preference rather than a second hard rule — see
 * {@link deriveFocusRing} for why demanding both is unsatisfiable.
 */
const MIN_RING_RATIO = 3;

// ============================================================================
// Parsing
// ============================================================================

/**
 * Normalize manager input to canonical `#rrggbb`, or `null` when it is not a
 * colour at all.
 *
 * Accepts `#abc`, `abc`, `#AABBCC`, `AABBCC` and surrounding whitespace —
 * nobody eyedroppers their own brand colour, they paste it from a brand guide,
 * and brand guides are inconsistent about the `#`. Rejects everything else
 * rather than guessing: this value is interpolated into an SSR'd `<style>` on
 * an anonymous page, so anything that is not six hex digits must not survive
 * to the emitter.
 */
export function normalizeBrandColor(input: string | null | undefined): HexColor | null {
	if (typeof input !== "string") return null;
	const trimmed = input.trim().toLowerCase();
	const body = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;

	if (/^[0-9a-f]{3}$/.test(body)) {
		return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
	}
	if (/^[0-9a-f]{6}$/.test(body)) {
		return `#${body}`;
	}
	return null;
}

/** `#rrggbb` → `[r, g, b]` in 0–255. Assumes a normalized input. */
function hexToRgb(hex: HexColor): [number, number, number] {
	const body = hex.startsWith("#") ? hex.slice(1) : hex;
	return [
		Number.parseInt(body.slice(0, 2), 16),
		Number.parseInt(body.slice(2, 4), 16),
		Number.parseInt(body.slice(4, 6), 16),
	];
}

function clamp01(value: number): number {
	return value < 0 ? 0 : value > 1 ? 1 : value;
}

function rgbToHex(r: number, g: number, b: number): HexColor {
	const channel = (value: number): string =>
		Math.round(clamp01(value) * 255)
			.toString(16)
			.padStart(2, "0");
	return `#${channel(r)}${channel(g)}${channel(b)}`;
}

// ============================================================================
// Contrast
// ============================================================================

/** sRGB channel (0–1) → linear light. WCAG 2.x transfer function. */
function srgbToLinear(channel: number): number {
	return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/** Linear light → sRGB channel (0–1). */
function linearToSrgb(channel: number): number {
	return channel <= 0.0031308 ? channel * 12.92 : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
}

/** WCAG relative luminance of a normalized hex colour. */
export function relativeLuminance(hex: HexColor): number {
	const [r, g, b] = hexToRgb(hex);
	return (
		0.2126 * srgbToLinear(r / 255) + 0.7152 * srgbToLinear(g / 255) + 0.0722 * srgbToLinear(b / 255)
	);
}

/**
 * WCAG contrast ratio between two colours, 1–21. Order-independent.
 */
export function contrastRatio(a: HexColor, b: HexColor): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	const lighter = Math.max(la, lb);
	const darker = Math.min(la, lb);
	return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The more readable of this theme's two inks on the given fill.
 *
 * Decided by comparing the two actual ratios, not by a luminance threshold —
 * see the module note. Ties go to the dark ink, which is the one that keeps a
 * pale brand looking like itself.
 */
export function readableInkOn(fill: HexColor): HexColor {
	const onLight = contrastRatio(fill, INK_LIGHT);
	const onDark = contrastRatio(fill, INK_DARK);
	return onDark >= onLight ? INK_DARK : INK_LIGHT;
}

// ============================================================================
// OKLCH
//
// Adjustments happen in OKLCH rather than sRGB so that lightening a saturated
// brand does not drift its hue, and so that an out-of-gamut result can be
// resolved by *reducing chroma* — which keeps the hue and the perceived
// lightness — instead of clamping RGB channels, which does neither.
// Matrices: Björn Ottosson's Oklab.
// ============================================================================

interface Oklch {
	/** Perceptual lightness, 0–1. */
	l: number;
	/** Chroma, 0–~0.4 for displayable sRGB. */
	c: number;
	/** Hue angle in degrees, 0–360. */
	h: number;
}

function hexToOklch(hex: HexColor): Oklch {
	const [r255, g255, b255] = hexToRgb(hex);
	const r = srgbToLinear(r255 / 255);
	const g = srgbToLinear(g255 / 255);
	const b = srgbToLinear(b255 / 255);

	const lms0 = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
	const lms1 = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
	const lms2 = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

	const l_ = Math.cbrt(lms0);
	const m_ = Math.cbrt(lms1);
	const s_ = Math.cbrt(lms2);

	const okL = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
	const okA = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
	const okB = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

	const c = Math.sqrt(okA * okA + okB * okB);
	// atan2 returns (-180, 180]; normalize so hue is always a positive angle.
	const h = c === 0 ? 0 : ((Math.atan2(okB, okA) * 180) / Math.PI + 360) % 360;

	return { l: okL, c, h };
}

/** Linear-RGB triple for an OKLCH colour, before any gamut decision. */
function oklchToLinearRgb({ l, c, h }: Oklch): [number, number, number] {
	const hRad = (h * Math.PI) / 180;
	const okA = c * Math.cos(hRad);
	const okB = c * Math.sin(hRad);

	const l_ = l + 0.3963377774 * okA + 0.2158037573 * okB;
	const m_ = l - 0.1055613458 * okA - 0.0638541728 * okB;
	const s_ = l - 0.0894841775 * okA - 1.291485548 * okB;

	const lms0 = l_ * l_ * l_;
	const lms1 = m_ * m_ * m_;
	const lms2 = s_ * s_ * s_;

	return [
		4.0767416621 * lms0 - 3.3077115913 * lms1 + 0.2309699292 * lms2,
		-1.2684380046 * lms0 + 2.6097574011 * lms1 - 0.3413193965 * lms2,
		-0.0041960863 * lms0 - 0.7034186147 * lms1 + 1.707614701 * lms2,
	];
}

/** Whether an OKLCH colour is displayable in sRGB, with a hair of tolerance. */
function isInGamut(color: Oklch): boolean {
	const [r, g, b] = oklchToLinearRgb(color);
	const epsilon = 1e-4;
	return (
		r >= -epsilon &&
		r <= 1 + epsilon &&
		g >= -epsilon &&
		g <= 1 + epsilon &&
		b >= -epsilon &&
		b <= 1 + epsilon
	);
}

/**
 * OKLCH → `#rrggbb`, **reducing chroma** until the colour fits in sRGB.
 *
 * Clamping the RGB channels instead would be simpler and wrong: clamping
 * shifts hue (it moves one channel and not the others) and lightens or darkens
 * the result unpredictably, which breaks the contrast guarantee this module
 * exists to provide. Bisecting on chroma keeps hue and lightness and gives up
 * only saturation, which is the one property nobody can name from memory.
 */
function oklchToHex(color: Oklch): HexColor {
	let usable = color;
	if (!isInGamut(color)) {
		let low = 0;
		let high = color.c;
		// 20 halvings resolves chroma far below any 8-bit-visible step.
		for (let i = 0; i < 20; i++) {
			const mid = (low + high) / 2;
			if (isInGamut({ ...color, c: mid })) low = mid;
			else high = mid;
		}
		usable = { ...color, c: low };
	}
	const [r, g, b] = oklchToLinearRgb(usable);
	return rgbToHex(linearToSrgb(clamp01(r)), linearToSrgb(clamp01(g)), linearToSrgb(clamp01(b)));
}

// ============================================================================
// Derivation
// ============================================================================

export interface BrandTokens {
	/** `--btn-primary-bg`: the brand fill, contrast-adjusted for this mode. */
	bg: HexColor;
	/** `--btn-primary-hover`. */
	hover: HexColor;
	/** `--btn-primary-text`: readable ink on `bg`. */
	text: HexColor;
	/** `--focus-ring`: reads against both `bg` and the mode's surface. */
	ring: HexColor;
	/**
	 * True when `bg` differs from the stored brand colour because contrast
	 * forced a change. The settings preview shows the adjusted swatch beside
	 * the raw one when this is set, so a manager is never surprised by a navy
	 * that renders lighter on dark screens.
	 */
	adjusted: boolean;
	/** Achieved ratio of `bg` against the mode's worst surface. */
	surfaceRatio: number;
	/** Achieved ratio of `text` against `bg`. */
	labelRatio: number;
}

/** Does this fill satisfy both guarantees for the mode? */
function meetsTargets(fill: HexColor, surface: HexColor): boolean {
	if (contrastRatio(fill, surface) < MIN_SURFACE_RATIO) return false;
	return contrastRatio(fill, readableInkOn(fill)) >= MIN_LABEL_RATIO;
}

/**
 * Walk lightness away from the surface until both guarantees hold.
 *
 * Direction is set by the mode — on a light surface a fill must get darker to
 * separate from it, on a dark surface lighter — but the label constraint pulls
 * the other way at the extremes, so the search tries the primary direction
 * first and falls back to the opposite one before giving up. Returns `null`
 * only if no lightness in the brand's hue satisfies both, which happens for
 * hues with very little available chroma range; the caller then keeps the raw
 * colour rather than emitting something arbitrary.
 */
function searchLightness(base: Oklch, surface: HexColor, towardDark: boolean): HexColor | null {
	const STEP = 0.01;
	for (const direction of towardDark ? [-1, 1] : [1, -1]) {
		for (let i = 0; i <= 100; i++) {
			const l = base.l + direction * i * STEP;
			if (l < 0 || l > 1) break;
			const candidate = oklchToHex({ ...base, l });
			if (meetsTargets(candidate, surface)) return candidate;
		}
	}
	return null;
}

/**
 * Derive the full token set for one mode from one stored brand colour.
 *
 * The same navy that reads beautifully on a white menu is an invisible button
 * on the dark one; this is what makes a single stored colour safe to apply in
 * both. `adjusted` tells the settings preview when to show its disclosure.
 */
export function deriveBrandTokens(brandColor: string, mode: BrandMode): BrandTokens | null {
	const normalized = normalizeBrandColor(brandColor);
	if (normalized === null) return null;

	const surface = WORST_SURFACE[mode];
	const base = hexToOklch(normalized);

	// On a light surface the fill separates by getting darker, and vice versa.
	const bg = meetsTargets(normalized, surface)
		? normalized
		: (searchLightness(base, surface, mode === "light") ?? normalized);

	const text = readableInkOn(bg);

	// Hover moves further from the surface, matching how the platform tokens
	// already behave (light: #2383e2 → darker #0b6bcb; dark: → lighter #4b9fe8).
	const bgOk = hexToOklch(bg);
	const hoverDelta = mode === "light" ? -0.05 : 0.06;
	const hover = oklchToHex({ ...bgOk, l: clamp01(bgOk.l + hoverDelta) });

	return {
		bg,
		hover,
		text,
		ring: deriveFocusRing(bg, mode),
		adjusted: bg !== normalized,
		surfaceRatio: contrastRatio(bg, surface),
		labelRatio: contrastRatio(bg, text),
	};
}

/**
 * A focus ring that is visible when the brand colour *is* the button.
 *
 * This feature introduces the bug it fixes: `base.css` draws the focus outline
 * in `--btn-primary-bg`, so the moment the brand colour becomes
 * `--btn-primary-bg`, tabbing to a primary button paints a brand ring on a
 * brand fill and the keyboard user loses their place entirely.
 *
 * **Contrast against the surface is the hard constraint, and contrast against
 * the fill is a preference.** That asymmetry is forced, not chosen. The
 * outline carries `outline-offset: 1px`, so a ring of page background always
 * separates it from the button and the surface is its only adjacent colour.
 * Requiring both would be unsatisfiable across a wide band of brands: for a
 * violet fill on the light card, clearing 3:1 against the surface caps ring
 * luminance at 0.26 while clearing 3:1 against the fill demands at least 0.39.
 * No colour is both, so a rule demanding both would silently fall back to
 * whatever the fallback happened to be — which is exactly how you ship an
 * invisible focus ring believing you guaranteed a visible one.
 *
 * So: search the brand's own hue (the ring should still look like the
 * restaurant's palette), keep only lightnesses that clear the surface, and
 * among those take the one that separates best from the fill — which keeps the
 * ring from reading as a slightly fatter button wherever that is achievable.
 */
export function deriveFocusRing(fill: HexColor, mode: BrandMode): HexColor {
	const surface = WORST_SURFACE[mode];
	const base = hexToOklch(fill);
	const STEP = 0.02;

	let best: HexColor | null = null;
	let bestFillRatio = -1;

	for (let i = 0; i <= 50; i++) {
		const candidate = oklchToHex({ ...base, l: i * STEP });
		if (contrastRatio(candidate, surface) < MIN_RING_RATIO) continue;
		const fillRatio = contrastRatio(candidate, fill);
		if (fillRatio > bestFillRatio) {
			bestFillRatio = fillRatio;
			best = candidate;
		}
	}

	// A candidate always exists — pure black clears any light surface and pure
	// white clears any dark one — but the ink colour for the *surface* is the
	// honest fallback if the hue sweep ever comes up empty.
	return best ?? readableInkOn(surface);
}
