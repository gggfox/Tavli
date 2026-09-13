/**
 * Which menu section the diner is in, and how to jump to one.
 *
 * One instance per menu, owned by `MenuBrowser`, feeding every surface that
 * shows the current category — the chip strip, the desktop rail, the
 * full-menu sheet — so they can never disagree.
 *
 * Driven by the scroll container's `scroll` event, recomputed once per frame.
 * Not an `IntersectionObserver`: one was tried, and it only fires when a
 * heading crosses its band. A tap parks the heading flush under the sticky
 * bar, a position no band edge sits on, so the last frame of a jump never
 * produced a callback and the pill stayed one section behind.
 */
import type { Doc } from "convex/_generated/dataModel";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	activeCategoryId,
	categorySectionId,
	nextActiveDuringJump,
} from "../components/CategoryPills";

/**
 * Longest a tapped pill stays pinned while its jump animates. A smooth scroll
 * across a long menu is well under a second; this is only the ceiling for a
 * heading that can never reach the top (a short last section).
 */
const JUMP_HOLD_MAX_MS = 2000;
/**
 * Breathing room between the sticky bar and a jumped-to heading. Must stay
 * comfortably under `REACHED_TOLERANCE_PX`: the spy decides "reached" by that
 * tolerance, and with the two equal a half-pixel of rounding on landing left
 * the pill on the previous section.
 */
export const JUMP_GAP_PX = 4;

interface Args {
	readonly categories: readonly Doc<"menuCategories">[];
	/** The scroll container the sections live in — NOT the window. */
	readonly scrollRef: React.RefObject<HTMLElement | null>;
	/**
	 * Height of whatever is stuck to the top of the container, in px. A
	 * function is accepted so the caller can measure the live bar: it is
	 * taller on a phone (search + chips) than on desktop (search alone), and
	 * the chips come and go.
	 */
	readonly stickyOffsetPx: number | (() => number);
}

export function useCategoryScrollSpy({ categories, scrollRef, stickyOffsetPx }: Args): {
	activeId: string | null;
	jumpTo: (id: string) => void;
} {
	const [activeId, setActiveId] = useState<string | null>(categories[0]?._id ?? null);
	const jumpTargetRef = useRef<string | null>(null);
	const jumpTimerRef = useRef<number | null>(null);
	// Read through a ref so a changing offset never re-subscribes the listener.
	const offsetRef = useRef(stickyOffsetPx);
	offsetRef.current = stickyOffsetPx;
	const offset = () =>
		typeof offsetRef.current === "function" ? offsetRef.current() : offsetRef.current;

	const clearJump = () => {
		jumpTargetRef.current = null;
		if (jumpTimerRef.current !== null) {
			window.clearTimeout(jumpTimerRef.current);
			jumpTimerRef.current = null;
		}
	};

	useEffect(() => {
		const root = scrollRef.current;
		if (!root || categories.length === 0) return;
		const headings = categories
			.map((category) => document.getElementById(categorySectionId(category._id)))
			.filter((element): element is HTMLElement => element !== null);
		if (headings.length === 0) return;

		let frame: number | null = null;
		const recompute = () => {
			frame = null;
			const visible = headings.flatMap((heading) => {
				const id = heading.dataset.categoryId;
				return id === undefined ? [] : [{ id, top: heading.getBoundingClientRect().top }];
			});
			if (visible.length === 0) return;
			// Measured from just under the sticky bar, not from the root's own
			// top: a heading parked flush beneath the bar is exactly the section
			// the diner just jumped to.
			const visibleTop = root.getBoundingClientRect().top + offset();
			const { active, jumpDone } = nextActiveDuringJump(
				activeCategoryId(visible, visibleTop),
				jumpTargetRef.current
			);
			if (jumpDone) clearJump();
			setActiveId(active);
		};
		const onScroll = () => {
			if (frame === null) frame = requestAnimationFrame(recompute);
		};
		root.addEventListener("scroll", onScroll, { passive: true });
		recompute();
		return () => {
			root.removeEventListener("scroll", onScroll);
			if (frame !== null) cancelAnimationFrame(frame);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- offset/clearJump read refs only
	}, [categories, scrollRef]);

	// The hold timer outlives any single scroll; make sure it dies with us.
	useEffect(() => clearJump, []);

	const jumpTo = useCallback(
		(id: string) => {
			const root = scrollRef.current;
			const heading = document.getElementById(categorySectionId(id));
			// Pin the tapped pill for the jump, with a ceiling — see
			// nextActiveDuringJump.
			clearJump();
			jumpTargetRef.current = id;
			jumpTimerRef.current = window.setTimeout(clearJump, JUMP_HOLD_MAX_MS);
			setActiveId(id);
			if (!root || !heading) return;
			const top =
				root.scrollTop +
				heading.getBoundingClientRect().top -
				root.getBoundingClientRect().top -
				offset() -
				JUMP_GAP_PX;
			// jsdom has no Element.scrollTo; a bare assignment keeps tests honest.
			if (typeof root.scrollTo === "function") root.scrollTo({ top, behavior: "smooth" });
			else root.scrollTop = top;
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps -- offset/clearJump read refs only
		[scrollRef]
	);

	return { activeId, jumpTo };
}
