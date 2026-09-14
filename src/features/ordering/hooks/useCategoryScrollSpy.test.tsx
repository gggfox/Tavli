/* eslint-disable boundaries/no-unknown-files, @typescript-eslint/no-explicit-any */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { categorySectionId, REACHED_TOLERANCE_PX } from "../components/CategoryPills";
import { JUMP_GAP_PX, useCategoryScrollSpy } from "./useCategoryScrollSpy";

const STICKY = 104;
const categories = [{ _id: "meats" }, { _id: "soups" }] as any;

/** Lay the headings out by hand — jsdom has no layout. */
function placeHeadings(tops: Record<string, number>, rootTop = 0) {
	for (const [id, top] of Object.entries(tops)) {
		const h = document.getElementById(categorySectionId(id))!;
		h.getBoundingClientRect = () =>
			({
				top,
				bottom: top + 24,
				left: 0,
				right: 100,
				width: 100,
				height: 24,
				x: 0,
				y: top,
				toJSON() {},
			}) as any;
	}
	root.getBoundingClientRect = () =>
		({
			top: rootTop,
			bottom: rootTop + 600,
			left: 0,
			right: 400,
			width: 400,
			height: 600,
			x: 0,
			y: rootTop,
			toJSON() {},
		}) as any;
}

let root: HTMLDivElement;

beforeEach(() => {
	root = document.createElement("div");
	for (const c of categories) {
		const h = document.createElement("h3");
		h.id = categorySectionId(c._id);
		h.dataset.categoryId = c._id;
		root.appendChild(h);
	}
	document.body.appendChild(root);
});

afterEach(() => {
	root.remove();
});

describe("useCategoryScrollSpy", () => {
	it("reports the section whose heading sits under the sticky bar after a scroll", async () => {
		const { result } = renderHook(() =>
			useCategoryScrollSpy({ categories, scrollRef: { current: root }, stickyOffsetPx: STICKY })
		);
		placeHeadings({ meats: -300, soups: STICKY });
		act(() => {
			root.dispatchEvent(new Event("scroll"));
		});
		await waitFor(() => expect(result.current.activeId).toBe("soups"));
	});

	it("lights the tapped pill immediately and holds it until the scroll arrives", async () => {
		const { result } = renderHook(() =>
			useCategoryScrollSpy({ categories, scrollRef: { current: root }, stickyOffsetPx: STICKY })
		);
		placeHeadings({ meats: STICKY, soups: 900 });
		act(() => {
			root.dispatchEvent(new Event("scroll"));
		});
		await waitFor(() => expect(result.current.activeId).toBe("meats"));

		act(() => {
			result.current.jumpTo("soups");
		});
		expect(result.current.activeId).toBe("soups");

		// Mid-flight: the scroll says "meats" is still current; the hold wins.
		placeHeadings({ meats: -50, soups: 500 });
		act(() => {
			root.dispatchEvent(new Event("scroll"));
		});
		await new Promise((r) => setTimeout(r, 40));
		expect(result.current.activeId).toBe("soups");
	});

	// A jump lands the heading JUMP_GAP_PX under the bar, and the spy calls it
	// reached within REACHED_TOLERANCE_PX. With the two equal, sub-pixel
	// rounding on landing decided the answer and the pill stayed one behind.
	it("lands a jump well inside the reached tolerance", () => {
		expect(JUMP_GAP_PX).toBeLessThan(REACHED_TOLERANCE_PX);
	});
});
