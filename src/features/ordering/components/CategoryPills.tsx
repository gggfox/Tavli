/**
 * Jump-to-section index for the diner menu (TAVLI-98).
 *
 * **Navigation, not filtering.** The search box above already removes
 * sections; these pills move you to one. Making them filter too would give the
 * page two controls doing the same job, and jumping to a section the search
 * has just hidden scrolls to nothing — which is why the whole row hides while
 * a search is active.
 *
 * Presentation only. Which pill is current, and what a tap does, come from
 * `useCategoryScrollSpy` in `MenuBrowser` — the same source that drives the
 * desktop rail and the full-menu sheet, so the three can never disagree.
 */
import { getTranslatedField } from "@/global/utils/translations";
import type { Doc } from "convex/_generated/dataModel";
import { useEffect, useRef } from "react";

interface CategoryPillsProps {
	readonly categories: readonly Doc<"menuCategories">[];
	readonly activeId: string | null;
	readonly onJump: (categoryId: string) => void;
	readonly lang?: string;
}

/** DOM id for a category's section heading. Shared with `MenuBrowser`. */
export function categorySectionId(categoryId: string): string {
	return `menu-category-${categoryId}`;
}

/**
 * Where the pill strip should be scrolled to bring one pill into the middle.
 *
 * Exists so the strip can be moved with `scrollTo`, which touches only the
 * element it is called on. The previous `pill.scrollIntoView()` walked *every*
 * scrollable ancestor, and the nearest one is the container the whole menu
 * scrolls in — so keeping the active pill visible silently cancelled the
 * diner's jump to a category mid-flight.
 */
export function pillStripScrollLeft({
	pillLeft,
	pillWidth,
	stripWidth,
	stripScrollWidth,
}: Readonly<{
	pillLeft: number;
	pillWidth: number;
	stripWidth: number;
	stripScrollWidth: number;
}>): number {
	const centred = pillLeft + pillWidth / 2 - stripWidth / 2;
	const maxScroll = Math.max(0, stripScrollWidth - stripWidth);
	return Math.min(Math.max(0, centred), maxScroll);
}

/**
 * A heading counts as reached once it is at, or within a few px below, the
 * visible top. The slack absorbs sub-pixel layout and the last frame of a
 * smooth scroll, which can settle a hair past its target.
 */
export const REACHED_TOLERANCE_PX = 8;

/**
 * Which section the diner is in, given each heading's top edge and the
 * y-coordinate of the *visible* top of the scroll container (its own top plus
 * the sticky bar). The last heading at or above that line wins; if every
 * heading is still below it we are at the very top, so the first section.
 * Headings must be in document order.
 */
export function activeCategoryId(
	headings: ReadonlyArray<{ id: string; top: number }>,
	visibleTop: number
): string | null {
	if (headings.length === 0) return null;
	const reached = headings.filter((heading) => heading.top - visibleTop <= REACHED_TOLERANCE_PX);
	return (reached.length > 0 ? reached[reached.length - 1] : headings[0]).id;
}

/**
 * Reconcile what the scroll position says with a jump the diner tapped.
 * While the jump is in flight the tapped pill wins, or the strip would light
 * every section the animation scrolls past. Once the computed section *is*
 * the target, the jump is over and scroll position takes back control.
 */
export function nextActiveDuringJump(
	computed: string | null,
	jumpTarget: string | null
): { active: string | null; jumpDone: boolean } {
	if (jumpTarget === null) return { active: computed, jumpDone: false };
	if (computed === jumpTarget) return { active: computed, jumpDone: true };
	return { active: jumpTarget, jumpDone: false };
}

export function CategoryPills({
	categories,
	activeId,
	onJump,
	lang,
}: Readonly<CategoryPillsProps>) {
	const pillRefs = useRef(new Map<string, HTMLButtonElement>());
	const stripRef = useRef<HTMLElement | null>(null);

	// Keep the active pill in view as the diner scrolls the *page*, or a long
	// menu leaves the current section's pill somewhere off to the right.
	//
	// Scrolls the strip by its own `scrollLeft` rather than calling
	// `scrollIntoView` on the pill. `scrollIntoView` also scrolls every
	// scrollable ancestor, and this strip sits inside the container the menu
	// scrolls in — so the tidy-up ran a second smooth scroll on that container
	// and cancelled the jump the diner had just asked for.
	useEffect(() => {
		if (!activeId) return;
		const strip = stripRef.current;
		const pill = pillRefs.current.get(activeId);
		if (!strip || !pill) return;
		strip.scrollTo({
			left: pillStripScrollLeft({
				pillLeft: pill.offsetLeft,
				pillWidth: pill.offsetWidth,
				stripWidth: strip.clientWidth,
				stripScrollWidth: strip.scrollWidth,
			}),
			behavior: "smooth",
		});
	}, [activeId]);

	if (categories.length < 2) {
		// One category is not an index, it is a label — and the whole menu is
		// already on screen.
		return null;
	}

	return (
		<nav ref={stripRef} aria-label="Menu categories" className="overflow-x-auto">
			<ul className="flex w-max gap-1.5 px-4 pb-2">
				{categories.map((category) => {
					const isActive = category._id === activeId;
					return (
						<li key={category._id}>
							<button
								type="button"
								ref={(element) => {
									if (element) pillRefs.current.set(category._id, element);
									else pillRefs.current.delete(category._id);
								}}
								aria-current={isActive ? "true" : undefined}
								onClick={() => onJump(category._id)}
								className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
									isActive ? "" : "hover-secondary"
								}`}
								style={
									isActive
										? {
												backgroundColor: "var(--btn-primary-bg)",
												color: "var(--btn-primary-text)",
											}
										: { backgroundColor: "var(--bg-secondary)", color: "var(--text-secondary)" }
								}
							>
								{getTranslatedField(category, lang)}
							</button>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
