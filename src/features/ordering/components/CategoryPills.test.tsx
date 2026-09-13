/* eslint-disable boundaries/no-unknown-files */
import { describe, expect, it } from "vitest";
import { activeCategoryId, nextActiveDuringJump, pillStripScrollLeft } from "./CategoryPills";

/**
 * The strip must be scrolled by its own `scrollLeft`, never by
 * `scrollIntoView`.
 *
 * `scrollIntoView` walks every scrollable ancestor, and the menu's ancestor is
 * the vertical container the whole page lives in. Starting a second smooth
 * scroll there cancels the one the diner's tap just began, which is why
 * tapping "Drinks" used to drift ~300px and stop. These numbers describe the
 * replacement: a target for the strip alone.
 */
describe("pillStripScrollLeft", () => {
	it("centres a pill that sits off the right edge", () => {
		// Pill spans 600–700 in a 300-wide window: centre it at 650 - 150 = 500.
		expect(
			pillStripScrollLeft({
				pillLeft: 600,
				pillWidth: 100,
				stripWidth: 300,
				stripScrollWidth: 1200,
			})
		).toBe(500);
	});

	it("never scrolls past the start for a pill near the left edge", () => {
		// Centring would ask for -100; a negative scrollLeft is silently clamped
		// by the browser, but returning it makes the intent untestable.
		expect(
			pillStripScrollLeft({
				pillLeft: 0,
				pillWidth: 100,
				stripWidth: 300,
				stripScrollWidth: 1200,
			})
		).toBe(0);
	});

	it("never scrolls past the end for the last pill", () => {
		// Max scroll is 1200 - 300 = 900.
		expect(
			pillStripScrollLeft({
				pillLeft: 1100,
				pillWidth: 100,
				stripWidth: 300,
				stripScrollWidth: 1200,
			})
		).toBe(900);
	});

	it("stays at zero when the strip does not overflow", () => {
		expect(
			pillStripScrollLeft({
				pillLeft: 40,
				pillWidth: 100,
				stripWidth: 400,
				stripScrollWidth: 400,
			})
		).toBe(0);
	});
});

/**
 * Which section is "current" is measured from the *visible* top of the scroll
 * container — the edge just under the sticky search+pills bar — not from the
 * container's own top. A heading a jump has parked flush under that bar is
 * the section the diner asked for; measuring from the root instead treated it
 * as not-yet-reached and lit the previous pill.
 */
describe("activeCategoryId", () => {
	const VISIBLE_TOP = 104;
	const headings = [
		{ id: "meats", top: -206 },
		{ id: "entries", top: 104 },
		{ id: "entress", top: 396 },
	];

	it("treats a heading parked flush under the sticky bar as reached", () => {
		expect(activeCategoryId(headings, VISIBLE_TOP)).toBe("entries");
	});

	it("keeps the previous section while the next heading is still below the bar", () => {
		expect(
			activeCategoryId(
				[
					{ id: "meats", top: -206 },
					{ id: "entries", top: 140 },
				],
				VISIBLE_TOP
			)
		).toBe("meats");
	});

	it("tolerates sub-pixel and smooth-scroll settle error", () => {
		expect(
			activeCategoryId(
				[
					{ id: "meats", top: -206 },
					{ id: "entries", top: 110 },
				],
				VISIBLE_TOP
			)
		).toBe("entries");
	});

	it("falls back to the first section when everything is still below the bar", () => {
		expect(
			activeCategoryId(
				[
					{ id: "meats", top: 300 },
					{ id: "entries", top: 700 },
				],
				VISIBLE_TOP
			)
		).toBe("meats");
	});

	it("returns null with nothing to choose from", () => {
		expect(activeCategoryId([], VISIBLE_TOP)).toBeNull();
	});
});

/**
 * While a tapped jump is in flight the strip holds the tapped pill. Without
 * this the scroll-driven recompute lights every section the animation passes
 * through, so tapping "Drinks" flashes Tacos, then Burritos, then Drinks.
 */
describe("nextActiveDuringJump", () => {
	it("follows the scroll position when no jump is in flight", () => {
		expect(nextActiveDuringJump("soups", null)).toEqual({ active: "soups", jumpDone: false });
	});

	it("holds the tapped pill while the animation is still short of it", () => {
		expect(nextActiveDuringJump("burritos", "drinks")).toEqual({
			active: "drinks",
			jumpDone: false,
		});
	});

	it("releases the hold once the scroll has actually arrived", () => {
		expect(nextActiveDuringJump("drinks", "drinks")).toEqual({ active: "drinks", jumpDone: true });
	});
});
