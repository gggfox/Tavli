import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND_FONTS, BRAND_FONT_IDS, brandFontPreloadHref } from "convex/_shared/brandFonts";

/**
 * `fonts.css` and `convex/_shared/brandFonts.ts` describe the same three fonts
 * twice, because a stylesheet cannot import a TypeScript module. Every failure
 * mode of that duplication is **silent**:
 *
 * - a family name that differs by one character → the page renders in the
 *   fallback forever, no error anywhere;
 * - a `src:` url pointing at a file nobody vendored → a 404 the diner never
 *   sees, and text that simply never swaps;
 * - a metric override that drifts from the measured value → the swap reflows,
 *   which is the exact thing the overrides were added to prevent;
 * - a `* Brand Fallback` face declared but missing from the stack → all four
 *   metrics computed, committed, and completely inert.
 *
 * Nothing above turns anything red on its own. These tests are the only thing
 * standing between a rename and a menu that quietly stops being branded.
 */

const ROOT = join(process.cwd());
const CSS = readFileSync(join(ROOT, "src/global/styles/fonts.css"), "utf8");

/** Per-request budget: what a diner on an English or Spanish page downloads. */
const LATIN_BUDGET_BYTES = 50 * 1024;

describe("fonts.css agrees with the font registry", () => {
	it.each([...BRAND_FONT_IDS])("declares an @font-face for %s", (id) => {
		const font = BRAND_FONTS[id];
		expect(CSS, `no @font-face names "${font.family}"`).toContain(`font-family: "${font.family}";`);
	});

	it.each([...BRAND_FONT_IDS])("serves both subset files for %s", (id) => {
		const font = BRAND_FONTS[id];
		expect(CSS).toContain(`url("/fonts/${font.files.latin}")`);
		expect(CSS).toContain(`url("/fonts/${font.files.latinExt}")`);
	});

	it.each([...BRAND_FONT_IDS])("uses the measured metrics for %s", (id) => {
		const { metrics, family } = BRAND_FONTS[id];
		const block = CSS.slice(
			CSS.indexOf(`font-family: "${family} Fallback";`),
			CSS.indexOf("}", CSS.indexOf(`font-family: "${family} Fallback";`))
		);
		expect(block, `no fallback @font-face for ${family}`).not.toBe("");

		// CSS drops a trailing zero that `toFixed(2)` keeps ("105.20%" vs
		// "105.2%"), so compare numerically rather than as text.
		const declared = (property: string): number => {
			const match = block.match(new RegExp(`${property}:\\s*([\\d.]+)%`));
			expect(match, `${family} fallback is missing ${property}`).not.toBeNull();
			return Number.parseFloat(match![1]);
		};
		expect(declared("size-adjust")).toBeCloseTo(Number.parseFloat(metrics.sizeAdjust), 2);
		expect(declared("ascent-override")).toBeCloseTo(Number.parseFloat(metrics.ascentOverride), 2);
		expect(declared("descent-override")).toBeCloseTo(Number.parseFloat(metrics.descentOverride), 2);
		expect(declared("line-gap-override")).toBeCloseTo(
			Number.parseFloat(metrics.lineGapOverride),
			2
		);
	});

	it.each([...BRAND_FONT_IDS])("names the metric-matched fallback in %s's stack", (id) => {
		// The face exists in CSS; this asserts something actually asks for it.
		const font = BRAND_FONTS[id];
		expect(
			font.stack,
			`${id}'s stack skips "${font.family} Fallback", so its measured metrics do nothing`
		).toContain(`"${font.family} Fallback"`);
	});

	it.each([...BRAND_FONT_IDS])("puts the real face ahead of its fallback for %s", (id) => {
		const font = BRAND_FONTS[id];
		const real = font.stack.indexOf(`"${font.family}"`);
		const fallback = font.stack.indexOf(`"${font.family} Fallback"`);
		expect(real).toBeGreaterThanOrEqual(0);
		expect(real, "the fallback would win over the real face").toBeLessThan(fallback);
	});

	it("declares no font family the registry does not know", () => {
		const declared = new Set(
			[...CSS.matchAll(/font-family:\s*"([^"]+)"/g)].map((m) => m[1].replace(/ Fallback$/, ""))
		);
		const known = new Set(BRAND_FONT_IDS.map((id) => BRAND_FONTS[id].family));
		for (const family of declared) {
			expect(
				known.has(family),
				`fonts.css declares "${family}", which no registry entry names`
			).toBe(true);
		}
	});
});

describe("the vendored font files", () => {
	it.each([...BRAND_FONT_IDS])("exist on disk for %s", (id) => {
		const font = BRAND_FONTS[id];
		for (const file of [font.files.latin, font.files.latinExt]) {
			expect(
				() => statSync(join(ROOT, "public/fonts", file)),
				`public/fonts/${file} is missing — run: node scripts/vendorBrandFonts.mjs`
			).not.toThrow();
		}
	});

	it.each([...BRAND_FONT_IDS])("keep %s's latin subset inside the per-request budget", (id) => {
		// latin-ext is deliberately unbudgeted: it downloads only for a page
		// containing a character outside Latin-1, which for an English or
		// Spanish menu is never.
		const bytes = statSync(join(ROOT, "public/fonts", BRAND_FONTS[id].files.latin)).size;
		expect(bytes).toBeLessThanOrEqual(LATIN_BUDGET_BYTES);
	});

	it("preloads the latin subset, never latin-ext", () => {
		// Preload takes one URL and cannot express "whichever subset this page
		// needs". Preloading latin-ext would spend the connection on a file
		// almost no page requests.
		for (const id of BRAND_FONT_IDS) {
			expect(brandFontPreloadHref(id)).toBe(`/fonts/${BRAND_FONTS[id].files.latin}`);
		}
	});
});

describe("the latin subset covers Spanish", () => {
	it("declares a unicode-range including the Latin-1 Supplement", () => {
		// The whole reason latin-ext is optional: á é í ó ú ñ ü ¿ ¡ all live in
		// U+00A1-U+00FF. If a future subset narrowed this range, Spanish menus
		// would start pulling latin-ext on every page — quietly tripling
		// Inter's font payload on the product's most-loaded screen.
		const ranges = [...CSS.matchAll(/unicode-range:\s*([^;]+);/g)].map((m) =>
			m[1].replace(/\s+/g, "")
		);
		const latinRanges = ranges.filter((r) => r.startsWith("U+0000-00FF"));
		expect(latinRanges.length, "no subset declares the U+0000-00FF range").toBe(
			BRAND_FONT_IDS.length
		);
	});
});
