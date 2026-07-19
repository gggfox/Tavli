import { useCallback, useEffect, useState, type RefObject } from "react";

/**
 * Find the nearest scrollable ancestor of `ref`.
 *
 * Virtualization needs the element that actually scrolls. In this app that is
 * almost never the component's own wrapper — it is `AdminPageLayout`'s inner
 * `overflow-y-auto` column, or the root `<main>`. Rather than making every
 * virtualized list introduce its own nested scroll container (which would give
 * the page two scrollbars and break the sticky admin chrome), we walk up and
 * reuse the existing one.
 *
 * Returns `null` on the server and until the first effect runs, which is what
 * `useVirtualizer`'s `getScrollElement` expects when there is nothing to
 * measure yet.
 */
export function useScrollParent(ref: RefObject<HTMLElement | null>): HTMLElement | null {
	const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null);

	useEffect(() => {
		const node = ref.current;
		if (!node) return;

		let current = node.parentElement;
		while (current) {
			const { overflowY } = globalThis.getComputedStyle(current);
			if (overflowY === "auto" || overflowY === "scroll") {
				setScrollParent(current);
				return;
			}
			current = current.parentElement;
		}
		// Nothing scrolls above us — fall back to the document scroller.
		setScrollParent(globalThis.document?.documentElement ?? null);
	}, [ref]);

	return scrollParent;
}

/**
 * Offset of `ref` inside `scrollParent`, in pixels. `useVirtualizer` needs this
 * as `scrollMargin` whenever the virtualized block does not start at the top of
 * the scroll container — here, below the sticky filter/toolbar chrome.
 */
export function useScrollMargin(
	ref: RefObject<HTMLElement | null>,
	scrollParent: HTMLElement | null
): number {
	const [margin, setMargin] = useState(0);

	const measure = useCallback(() => {
		const node = ref.current;
		if (!node || !scrollParent) return;
		const offset =
			node.getBoundingClientRect().top -
			scrollParent.getBoundingClientRect().top +
			scrollParent.scrollTop;
		setMargin((previous) => (Math.abs(previous - offset) < 1 ? previous : offset));
	}, [ref, scrollParent]);

	useEffect(() => {
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		if (ref.current) observer.observe(ref.current);
		if (scrollParent) observer.observe(scrollParent);
		return () => observer.disconnect();
	}, [measure, ref, scrollParent]);

	return margin;
}
