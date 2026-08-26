import { describe, expect, it } from "vitest";
import { deriveBrandTokens } from "convex/_shared/brandColor";
import { buildBrandingCss } from "./brandingCss";

/**
 * The `:root` ruling, pinned.
 *
 * `theme.css` bridges raw tokens into Tailwind with `@theme { --color-primary:
 * var(--btn-primary-bg) }`, which compiles to a declaration on `:root`. A
 * custom property substitutes on the element carrying the declaration, so
 * `--color-primary` resolves against `:root` — not against whatever element is
 * being painted.
 *
 * Move these overrides to a wrapper and every inline `var(--btn-primary-bg)`
 * style and `hover-btn-primary` utility still retints, while every
 * `bg-primary` / `text-primary` utility silently keeps the platform blue. The
 * page comes out roughly 70% branded, with no error and no obvious pattern to
 * which parts missed. That is not a bug a screenshot review catches.
 */
describe("buildBrandingCss", () => {
	it("emits nothing when there is no branding", () => {
		expect(buildBrandingCss(null)).toBe("");
		expect(buildBrandingCss(undefined)).toBe("");
		expect(buildBrandingCss({})).toBe("");
	});

	it("targets :root, never a wrapper or a class", () => {
		const css = buildBrandingCss({ color: "#0f7b6c" });
		expect(css).toContain(":root:not(.dark){");
		expect(css).toContain(":root.dark{");
		// Every selector in the output must start at :root.
		for (const selector of css.matchAll(/([^{}]+)\{/g)) {
			expect(selector[1].trim().startsWith(":root"), selector[1]).toBe(true);
		}
	});

	it("emits both modes, because the server cannot know the diner's", () => {
		const css = buildBrandingCss({ color: "#0b1f3a" });
		const light = deriveBrandTokens("#0b1f3a", "light")!;
		const dark = deriveBrandTokens("#0b1f3a", "dark")!;
		expect(css).toContain(`--btn-primary-bg:${light.bg}`);
		expect(css).toContain(`--btn-primary-bg:${dark.bg}`);
		// The headline case: one navy is a fine light button and an invisible
		// dark one, so the two blocks must actually differ.
		expect(light.bg).not.toBe(dark.bg);
	});

	it("overrides the focus ring, or this feature ships the bug it fixes", () => {
		// base.css used to draw the outline in --btn-primary-bg. Once that token
		// IS the brand colour, a focused primary button rings itself in its own
		// fill and a keyboard user loses their place entirely.
		const css = buildBrandingCss({ color: "#0f7b6c" });
		const light = deriveBrandTokens("#0f7b6c", "light")!;
		expect(css).toContain(`--focus-ring:${light.ring}`);
		expect(light.ring).not.toBe(light.bg);
	});

	it("never sets --color-primary or the other @theme aliases", () => {
		// They already point at the raw tokens. Setting both would be two
		// sources of truth that drift the first time one is edited.
		const css = buildBrandingCss({ color: "#0f7b6c", fontStack: "X, sans-serif" });
		expect(css).not.toContain("--color-primary");
		expect(css).not.toContain("--color-foreground");
		expect(css).not.toContain("--font-sans");
	});

	it("never touches semantic colour", () => {
		// Order status is meaning, not decoration: green is ready, amber is
		// waiting. A green-branded restaurant must not repaint "waiting" as
		// "ready" on the kitchen's behalf.
		const css = buildBrandingCss({ color: "#0f7b6c" });
		expect(css).not.toContain("--accent-");
		expect(css).not.toContain("--station-");
	});

	it("sets the font once, outside the mode blocks", () => {
		// A typeface is not a property of light vs dark; emitting it twice
		// would just be two chances to disagree.
		const css = buildBrandingCss({ fontStack: '"Inter Brand", sans-serif' });
		expect(css).toBe(':root{--font-body:"Inter Brand", sans-serif;}');
	});

	it("emits font-only and colour-only branding independently", () => {
		expect(buildBrandingCss({ color: "#0f7b6c" })).not.toContain("--font-body");
		expect(buildBrandingCss({ fontStack: "X, sans-serif" })).not.toContain("--btn-primary-bg");
	});

	it("is a pure function of its input", () => {
		// `head()` re-runs on hydration and TanStack does not set
		// `suppressHydrationWarning` on `style`, so any non-determinism here is
		// a hydration mismatch on every single customer page load.
		const input = { color: "#0f7b6c", fontStack: "X, sans-serif" };
		expect(buildBrandingCss(input)).toBe(buildBrandingCss(input));
		expect(buildBrandingCss(input)).toBe(buildBrandingCss({ ...input }));
	});

	describe("refuses to emit anything that could escape a declaration", () => {
		// The colour is normalized on write and re-normalized on read, and the
		// font stack comes from a closed registry — so nothing hostile should
		// reach here. But this is the one place a restaurant-controlled string
		// becomes executable stylesheet text on an anonymous page, and a `}`
		// would hand authorship of the rest of the sheet to whoever set it.
		const hostile = [
			"}body{display:none}",
			"red;}\n:root{--btn-primary-bg:red",
			"url(https://evil.example/x)",
			"/* */;color:red",
			"@import url(https://evil.example/x)",
			"expression(alert(1))",
			"var(--x)\\",
		];

		it.each(hostile)("drops a hostile font stack: %s", (value) => {
			const css = buildBrandingCss({ fontStack: value });
			expect(css).not.toContain(value);
			for (const forbidden of ["}", "{", "@import", "url(", "/*"]) {
				// Braces from our own wrapper are fine; the point is that none of
				// the hostile payload survived, so the output is either empty or
				// a well-formed rule we authored.
				if (forbidden === "{" || forbidden === "}") continue;
				expect(css).not.toContain(forbidden);
			}
		});

		it("drops a hostile colour before it reaches the emitter", () => {
			// `normalizeBrandColor` rejects it first, so nothing is emitted at
			// all — belt and braces, in that order.
			const css = buildBrandingCss({ color: "#000;} body{display:none}" });
			expect(css).toBe("");
		});
	});
});
