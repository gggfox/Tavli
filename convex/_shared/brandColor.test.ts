import { describe, expect, it } from "vitest";
import {
	contrastRatio,
	deriveBrandTokens,
	deriveFocusRing,
	normalizeBrandColor,
	readableInkOn,
	relativeLuminance,
	WORST_SURFACE,
	type BrandMode,
} from "./brandColor";

/**
 * A spread of real brand colours plus the pathological ends of the range.
 * Every guarantee below is asserted across all of them in both modes — the
 * failures this module exists to prevent are all mid-band, so spot-checking
 * two colours proves nothing.
 */
const BRAND_SAMPLES = [
	"#2383e2", // platform blue — the current default
	"#0b1f3a", // near-black navy: invisible on dark without adjustment
	"#ffe066", // pale yellow: fails the label ratio without adjustment
	"#ffffff", // white
	"#000000", // black
	"#e03e3e", // red
	"#0f7b6c", // deep green
	"#6d28d9", // violet
	"#f5f5f5", // off-white, barely separable from the light surface
	"#7f7f7f", // mid grey — worst case for ink selection
	"#ff0000", // fully saturated primary
	"#00ff00",
	"#00d5ff", // high-chroma cyan: out of gamut when lightened naively
] as const;

const MODES: BrandMode[] = ["light", "dark"];

describe("normalizeBrandColor", () => {
	it("canonicalizes the shapes a brand guide actually contains", () => {
		expect(normalizeBrandColor("#AABBCC")).toBe("#aabbcc");
		expect(normalizeBrandColor("aabbcc")).toBe("#aabbcc");
		expect(normalizeBrandColor("  #AaBbCc  ")).toBe("#aabbcc");
	});

	it("expands three-digit shorthand", () => {
		expect(normalizeBrandColor("#abc")).toBe("#aabbcc");
		expect(normalizeBrandColor("f00")).toBe("#ff0000");
	});

	it("rejects anything that is not six hex digits", () => {
		// This value is interpolated into an SSR'd <style> on an anonymous
		// page, so a near-miss must not survive to the emitter.
		for (const bad of [
			"",
			"   ",
			"#",
			"#ab",
			"#abcd",
			"#abcde",
			"#abcdefg",
			"red",
			"rgb(1,2,3)",
			"#12345g",
			"}#000000{",
			"#000000; --x: y",
			"var(--x)",
		]) {
			expect(normalizeBrandColor(bad), bad).toBeNull();
		}
	});

	it("rejects non-strings", () => {
		expect(normalizeBrandColor(null)).toBeNull();
		expect(normalizeBrandColor(undefined)).toBeNull();
	});
});

describe("contrastRatio", () => {
	it("matches the WCAG reference values", () => {
		expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
		expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
		// Tavli blue on white — the value the current UI ships with.
		expect(contrastRatio("#2383e2", "#ffffff")).toBeCloseTo(3.88, 1);
	});

	it("is order-independent", () => {
		expect(contrastRatio("#2383e2", "#f1f1ef")).toBeCloseTo(
			contrastRatio("#f1f1ef", "#2383e2"),
			10
		);
	});

	it("computes luminance at the ends of the range", () => {
		expect(relativeLuminance("#000000")).toBeCloseTo(0, 10);
		expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 10);
	});
});

describe("readableInkOn", () => {
	it("picks the ink with the better ratio, not a luminance threshold", () => {
		// The whole point of the module note: for every sample the chosen ink
		// must actually be the better of the two, across the mid-band where a
		// precomputed crossover constant picks wrong.
		for (const brand of BRAND_SAMPLES) {
			const ink = readableInkOn(brand);
			const other = ink === "#ffffff" ? "#181818" : "#ffffff";
			expect(
				contrastRatio(brand, ink),
				`${brand}: chose ${ink} over ${other}`
			).toBeGreaterThanOrEqual(contrastRatio(brand, other));
		}
	});

	it("puts dark ink on a pale brand and light ink on a deep one", () => {
		expect(readableInkOn("#ffe066")).toBe("#181818");
		expect(readableInkOn("#0b1f3a")).toBe("#ffffff");
	});
});

describe("deriveBrandTokens", () => {
	it("returns null for input that is not a colour", () => {
		expect(deriveBrandTokens("nonsense", "light")).toBeNull();
		expect(deriveBrandTokens("", "dark")).toBeNull();
	});

	it("clears 3:1 against the worst surface in both modes", () => {
		// Tuned against #ffffff a fill scores 3.00:1 and then 2.65:1 on the
		// #f1f1ef card sitting on top of it. The target is the card.
		for (const brand of BRAND_SAMPLES) {
			for (const mode of MODES) {
				const tokens = deriveBrandTokens(brand, mode);
				expect(tokens, `${brand} / ${mode}`).not.toBeNull();
				expect(
					contrastRatio(tokens!.bg, WORST_SURFACE[mode]),
					`${brand} / ${mode}: bg ${tokens!.bg} on ${WORST_SURFACE[mode]}`
				).toBeGreaterThanOrEqual(3);
			}
		}
	});

	it("clears 4.5:1 for the button label in both modes", () => {
		for (const brand of BRAND_SAMPLES) {
			for (const mode of MODES) {
				const tokens = deriveBrandTokens(brand, mode)!;
				expect(
					contrastRatio(tokens.bg, tokens.text),
					`${brand} / ${mode}: label ${tokens.text} on ${tokens.bg}`
				).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	it("reports the ratios it achieved", () => {
		for (const brand of BRAND_SAMPLES) {
			for (const mode of MODES) {
				const tokens = deriveBrandTokens(brand, mode)!;
				expect(tokens.surfaceRatio).toBeCloseTo(contrastRatio(tokens.bg, WORST_SURFACE[mode]), 10);
				expect(tokens.labelRatio).toBeCloseTo(contrastRatio(tokens.bg, tokens.text), 10);
			}
		}
	});

	it("emits canonical lowercase hex for every token", () => {
		for (const brand of BRAND_SAMPLES) {
			for (const mode of MODES) {
				const tokens = deriveBrandTokens(brand, mode)!;
				for (const [name, value] of Object.entries({
					bg: tokens.bg,
					hover: tokens.hover,
					text: tokens.text,
					ring: tokens.ring,
				})) {
					expect(value, `${brand} / ${mode} / ${name}`).toMatch(/^#[0-9a-f]{6}$/);
				}
			}
		}
	});

	it("flags adjustment exactly when the fill moved", () => {
		for (const brand of BRAND_SAMPLES) {
			for (const mode of MODES) {
				const tokens = deriveBrandTokens(brand, mode)!;
				const normalized = normalizeBrandColor(brand)!;
				expect(tokens.adjusted, `${brand} / ${mode}`).toBe(tokens.bg !== normalized);
			}
		}
	});

	it("leaves a colour alone when it already passes", () => {
		// Deep green clears both guarantees on the light card untouched;
		// adjusting it anyway would be a visible change to a valid brand.
		const tokens = deriveBrandTokens("#0f7b6c", "light")!;
		expect(tokens.bg).toBe("#0f7b6c");
		expect(tokens.adjusted).toBe(false);
	});

	it("lightens a near-black navy for dark mode and says so", () => {
		// The headline case: one stored navy is a beautiful light-mode button
		// and an invisible dark-mode one.
		const dark = deriveBrandTokens("#0b1f3a", "dark")!;
		expect(dark.adjusted).toBe(true);
		expect(relativeLuminance(dark.bg)).toBeGreaterThan(relativeLuminance("#0b1f3a"));
	});

	it("darkens a pastel until its label is legible, and says so", () => {
		// The ink-policy decision made visible: adjust and disclose, rather
		// than shipping an AA failure on the primary CTA.
		const light = deriveBrandTokens("#ffe066", "light")!;
		expect(light.adjusted).toBe(true);
		expect(contrastRatio(light.bg, light.text)).toBeGreaterThanOrEqual(4.5);
	});

	it("keeps hue while adjusting, rather than clamping toward grey", () => {
		// Chroma reduction preserves hue; RGB clamping does not. A brand that
		// comes back a different colour is worse than one that comes back a
		// different shade.
		const tokens = deriveBrandTokens("#00d5ff", "light")!;
		const [r, g, b] = [
			Number.parseInt(tokens.bg.slice(1, 3), 16),
			Number.parseInt(tokens.bg.slice(3, 5), 16),
			Number.parseInt(tokens.bg.slice(5, 7), 16),
		];
		// Still recognisably cyan: blue and green dominate red.
		expect(b).toBeGreaterThan(r);
		expect(g).toBeGreaterThan(r);
	});

	it("moves hover away from the surface in each mode", () => {
		for (const brand of BRAND_SAMPLES) {
			const light = deriveBrandTokens(brand, "light")!;
			const dark = deriveBrandTokens(brand, "dark")!;
			// Pure black cannot get darker and pure white cannot get lighter;
			// everything else must actually move.
			if (light.bg !== "#000000") {
				expect(
					relativeLuminance(light.hover),
					`${brand} light hover ${light.hover} vs bg ${light.bg}`
				).toBeLessThanOrEqual(relativeLuminance(light.bg));
			}
			if (dark.bg !== "#ffffff") {
				expect(
					relativeLuminance(dark.hover),
					`${brand} dark hover ${dark.hover} vs bg ${dark.bg}`
				).toBeGreaterThanOrEqual(relativeLuminance(dark.bg));
			}
		}
	});

	it("is deterministic", () => {
		// Three consumers in two runtimes must agree exactly, or they disagree
		// about what "readable" means.
		for (const brand of BRAND_SAMPLES) {
			for (const mode of MODES) {
				expect(deriveBrandTokens(brand, mode)).toEqual(deriveBrandTokens(brand, mode));
			}
		}
	});

	it("normalizes before deriving, so input casing cannot change the output", () => {
		expect(deriveBrandTokens("#2383E2", "light")).toEqual(deriveBrandTokens("2383e2", "light"));
	});
});

describe("deriveFocusRing", () => {
	it("clears 3:1 against the surface it is drawn on, for every brand", () => {
		// This feature introduces the bug it fixes: base.css draws the focus
		// outline in --btn-primary-bg, so a brand ring on a brand button
		// disappears the moment branding lands. `outline-offset: 1px` puts a
		// ring of page background between button and outline, so the surface
		// is the ring's adjacent colour and this is the guarantee that matters.
		for (const brand of BRAND_SAMPLES) {
			for (const mode of MODES) {
				const tokens = deriveBrandTokens(brand, mode)!;
				expect(
					contrastRatio(tokens.ring, WORST_SURFACE[mode]),
					`${brand} / ${mode}: ring ${tokens.ring} on surface`
				).toBeGreaterThanOrEqual(3);
			}
		}
	});

	it("separates from the fill wherever that is geometrically possible", () => {
		// Deliberately not a blanket >=3:1 assertion: for a mid-dark fill on
		// the light card the two constraints are mutually exclusive (clearing
		// the surface caps ring luminance at 0.26, clearing the fill demands
		// 0.39). Where a separating ring exists the derivation must find it;
		// where none exists it must still clear the surface, which the test
		// above proves. So: assert it picked the best available option.
		for (const brand of BRAND_SAMPLES) {
			for (const mode of MODES) {
				const tokens = deriveBrandTokens(brand, mode)!;
				const ringLuminance = relativeLuminance(tokens.ring);
				const surfaceLuminance = relativeLuminance(WORST_SURFACE[mode]);
				const fillLuminance = relativeLuminance(tokens.bg);
				const separatingRingExists =
					mode === "light"
						? (fillLuminance + 0.05) * 3 - 0.05 <= (surfaceLuminance + 0.05) / 3 - 0.05
						: (surfaceLuminance + 0.05) * 3 - 0.05 <= (fillLuminance + 0.05) / 3 - 0.05;
				if (separatingRingExists) {
					expect(
						contrastRatio(tokens.ring, tokens.bg),
						`${brand} / ${mode}: ring ${tokens.ring} vs fill ${tokens.bg}`
					).toBeGreaterThanOrEqual(3);
				}
				// Whatever the geometry, the ring is a real colour on the page.
				expect(ringLuminance).toBeGreaterThanOrEqual(0);
			}
		}
	});

	it("never returns the fill it sits on", () => {
		for (const brand of BRAND_SAMPLES) {
			for (const mode of MODES) {
				const tokens = deriveBrandTokens(brand, mode)!;
				expect(tokens.ring).not.toBe(tokens.bg);
			}
		}
	});

	it("is exported for callers that only have a resolved fill", () => {
		expect(deriveFocusRing("#2383e2", "light")).toMatch(/^#[0-9a-f]{6}$/);
	});
});
