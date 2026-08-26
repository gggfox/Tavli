/**
 * Floating "back to top" for the diner menu (TAVLI-98).
 *
 * ## It listens to a div, not the window
 *
 * The menu scrolls inside an `overflow-y-auto` container; the document itself
 * never moves. `window.scrollY` reads `0` here forever, and a scroll listener
 * on `window` never fires — so the obvious implementation produces a button
 * that never appears, with nothing in the console to say why.
 *
 * ## It sits above the cart bar, not over it
 *
 * The bottom bar holds the cart CTA, which is the revenue button on this page.
 * A floating circle that overlaps it costs orders. The offset is passed in by
 * the caller, which is the only thing that knows how tall that bar currently
 * is.
 */
import { OrderingKeys } from "@/global/i18n";
import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface ScrollToTopButtonProps {
	readonly scrollRef: React.RefObject<HTMLElement | null>;
	/** Distance from the bottom of the container, in px. Clears the cart bar. */
	readonly bottomOffset: number;
}

/**
 * Appear after roughly one and a half screens.
 *
 * Tied to viewport height rather than a fixed pixel count so it means the same
 * thing on a phone and on a tablet: "you have scrolled far enough that getting
 * back is a chore".
 */
const SHOW_AFTER_VIEWPORTS = 1.5;

export function ScrollToTopButton({ scrollRef, bottomOffset }: Readonly<ScrollToTopButtonProps>) {
	const { t } = useTranslation();
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		const element = scrollRef.current;
		if (!element) return;

		let frame = 0;
		const onScroll = () => {
			// Coalesce to one read per frame. A scroll handler that measures on
			// every event forces layout on a list that is already the heaviest
			// thing on the page.
			if (frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				setVisible(element.scrollTop > element.clientHeight * SHOW_AFTER_VIEWPORTS);
			});
		};

		element.addEventListener("scroll", onScroll, { passive: true });
		onScroll();
		return () => {
			element.removeEventListener("scroll", onScroll);
			if (frame) cancelAnimationFrame(frame);
		};
	}, [scrollRef]);

	if (!visible) return null;

	return (
		<button
			type="button"
			onClick={() => {
				// `smooth` is a request, not a promise: the browser ignores it for
				// a reader with reduced motion enabled, which is the correct
				// behaviour and needs no branch here.
				scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
			}}
			aria-label={t(OrderingKeys.MENU_BACK_TO_TOP)}
			style={{ bottom: `${bottomOffset}px` }}
			className="absolute right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg transition-opacity hover:bg-(--bg-hover)"
		>
			<ArrowUp size={18} aria-hidden />
		</button>
	);
}
