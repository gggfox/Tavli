/**
 * Has `target` scrolled entirely above the top of `scrollRef`'s container?
 *
 * The menu's category tiles use it: while they are on screen they are the
 * index, and once they have gone the compact chip bar takes over. Recomputed
 * once per frame from the container's `scroll` event — same reasoning as
 * `useCategoryScrollSpy`, and the same reason it is not an observer.
 */
import { useEffect, useState } from "react";

export function useScrolledPast(
	target: React.RefObject<HTMLElement | null>,
	scrollRef: React.RefObject<HTMLElement | null>
): boolean {
	const [passed, setPassed] = useState(false);

	useEffect(() => {
		const root = scrollRef.current;
		if (!root) return;
		let frame: number | null = null;
		const recompute = () => {
			frame = null;
			const el = target.current;
			if (!el) {
				setPassed(false);
				return;
			}
			setPassed(el.getBoundingClientRect().bottom <= root.getBoundingClientRect().top);
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
	}, [target, scrollRef]);

	return passed;
}
