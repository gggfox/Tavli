import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { deriveBrandTokens } from "convex/_shared/brandColor";
import { SYSTEM_FONT_STACK } from "convex/_shared/brandFonts";
import { BrandingPreviewPane } from "./BrandingPreviewPane";

/**
 * The preview's only job is to not lie.
 *
 * On a real `/r/` page the brand tokens are injected at `:root`, which is what
 * makes Tailwind's `bg-primary` utilities pick them up — `@theme` compiles to
 * `:root { --color-primary: var(--btn-primary-bg) }`, and a custom property
 * substitutes on the element carrying the declaration.
 *
 * This pane lives inside the dashboard so it *must* be scoped to a wrapper,
 * which is precisely the case where that mechanism breaks. A wrapper that sets
 * only `--btn-primary-bg` still retints inline `var()` styles and
 * `hover-btn-primary`, so the preview looks branded — while every `bg-primary`
 * utility inside it silently keeps resolving against `:root` and paints
 * platform blue. The manager approves a colour on the strength of a preview
 * that is ~70% right.
 *
 * These tests pin both token layers. Deleting either one is a change no
 * screenshot review would reliably catch.
 */
function paneStyle(mode: "light" | "dark"): CSSStyleDeclaration {
	return (screen.getByTestId(`branding-preview-${mode}`) as HTMLElement).style;
}

describe("BrandingPreviewPane", () => {
	it("sets the raw token layer that inline var() styles read", () => {
		render(
			<BrandingPreviewPane
				brandColor="#0f7b6c"
				mode="light"
				fontStack={SYSTEM_FONT_STACK}
				restaurantName="La Cocina"
			/>
		);
		const style = paneStyle("light");
		const expected = deriveBrandTokens("#0f7b6c", "light")!;
		expect(style.getPropertyValue("--btn-primary-bg")).toBe(expected.bg);
		expect(style.getPropertyValue("--btn-primary-hover")).toBe(expected.hover);
		expect(style.getPropertyValue("--btn-primary-text")).toBe(expected.text);
		expect(style.getPropertyValue("--focus-ring")).toBe(expected.ring);
	});

	it("also sets the Tailwind alias layer, or every bg-primary in the pane lies", () => {
		render(
			<BrandingPreviewPane
				brandColor="#0f7b6c"
				mode="light"
				fontStack={SYSTEM_FONT_STACK}
				restaurantName="La Cocina"
			/>
		);
		const style = paneStyle("light");
		const expected = deriveBrandTokens("#0f7b6c", "light")!;
		expect(style.getPropertyValue("--color-primary")).toBe(expected.bg);
		expect(style.getPropertyValue("--color-primary-hover")).toBe(expected.hover);
		expect(style.getPropertyValue("--color-primary-foreground")).toBe(expected.text);
	});

	it("writes concrete hexes, never a var() chain", () => {
		// `--color-primary: var(--btn-primary-bg)` would resolve correctly here
		// (both live on the wrapper) while the same declaration at `:root` on a
		// real page would not. Two resolution paths for one design is how the
		// preview and the live page drift without either looking broken.
		render(
			<BrandingPreviewPane
				brandColor="#0f7b6c"
				mode="dark"
				fontStack={SYSTEM_FONT_STACK}
				restaurantName="La Cocina"
			/>
		);
		const style = paneStyle("dark");
		for (const token of [
			"--btn-primary-bg",
			"--btn-primary-hover",
			"--btn-primary-text",
			"--color-primary",
			"--color-primary-hover",
			"--color-primary-foreground",
			"--focus-ring",
		]) {
			expect(style.getPropertyValue(token), token).toMatch(/^#[0-9a-f]{6}$/);
		}
	});

	it("runs its own derivation per mode, so the two panes can differ", () => {
		// A single navy is a fine light-mode button and an invisible dark-mode
		// one. Sharing one derivation across both panes would hide exactly the
		// adjustment the preview exists to disclose.
		const { rerender } = render(
			<BrandingPreviewPane
				brandColor="#0b1f3a"
				mode="light"
				fontStack={SYSTEM_FONT_STACK}
				restaurantName="La Cocina"
			/>
		);
		const lightBg = paneStyle("light").getPropertyValue("--btn-primary-bg");

		rerender(
			<BrandingPreviewPane
				brandColor="#0b1f3a"
				mode="dark"
				fontStack={SYSTEM_FONT_STACK}
				restaurantName="La Cocina"
			/>
		);
		const darkBg = paneStyle("dark").getPropertyValue("--btn-primary-bg");

		expect(darkBg).not.toBe(lightBg);
	});

	it("carries the mode class so surfaces come from the right palette", () => {
		// Without this a `light` preview inside a dark dashboard inherits every
		// dark surface token and previews the wrong background entirely.
		render(
			<BrandingPreviewPane
				brandColor="#0f7b6c"
				mode="light"
				fontStack={SYSTEM_FONT_STACK}
				restaurantName="La Cocina"
			/>
		);
		expect(screen.getByTestId("branding-preview-light").className).toContain("light");
	});

	it("discloses an adjustment, showing the raw colour beside the adjusted one", () => {
		render(
			<BrandingPreviewPane
				brandColor="#ffe066"
				mode="light"
				fontStack={SYSTEM_FONT_STACK}
				restaurantName="La Cocina"
			/>
		);
		expect(deriveBrandTokens("#ffe066", "light")!.adjusted).toBe(true);
		expect(screen.getByText(/Adjusted for contrast/i)).toBeTruthy();
	});

	it("stays quiet when the colour was good enough to leave alone", () => {
		render(
			<BrandingPreviewPane
				brandColor="#0f7b6c"
				mode="light"
				fontStack={SYSTEM_FONT_STACK}
				restaurantName="La Cocina"
			/>
		);
		expect(deriveBrandTokens("#0f7b6c", "light")!.adjusted).toBe(false);
		expect(screen.queryByText(/Adjusted for contrast/i)).toBeNull();
	});

	it("previews the platform default when no colour is set", () => {
		// Clearing the brand colour must show what diners will actually get,
		// not an empty pane.
		render(
			<BrandingPreviewPane
				brandColor={null}
				mode="light"
				fontStack={SYSTEM_FONT_STACK}
				restaurantName="La Cocina"
			/>
		);
		expect(paneStyle("light").getPropertyValue("--btn-primary-bg")).toBe("#2383e2");
	});

	it("renders a real 360px column rather than a scaled-down wide one", () => {
		// `transform: scale()` shrinks the rendered result, so text that would
		// wrap on a phone does not wrap here — the manager signs off on a
		// layout that does not exist.
		render(
			<BrandingPreviewPane
				brandColor="#0f7b6c"
				mode="light"
				fontStack={SYSTEM_FONT_STACK}
				restaurantName="La Cocina"
			/>
		);
		const style = paneStyle("light");
		expect(style.width).toBe("360px");
		expect(style.transform).toBe("");
	});
});
