/**
 * Jump-to-section index for the diner menu (TAVLI-98).
 *
 * **Navigation, not filtering.** The search box above already removes
 * sections; these pills move you to one. Making them filter too would give the
 * page two controls doing the same job, and jumping to a section the search
 * has just hidden scrolls to nothing — which is why the whole row hides while
 * a search is active.
 *
 * The active pill is driven by an `IntersectionObserver` on the section
 * headings, so the row reports where you *are* rather than only where you last
 * tapped. That is the difference between an index and a row of buttons: scroll
 * with your thumb and the pills follow.
 */
import { getTranslatedField } from "@/global/utils/translations";
import type { Doc } from "convex/_generated/dataModel";
import { useEffect, useRef, useState } from "react";

interface CategoryPillsProps {
	readonly categories: readonly Doc<"menuCategories">[];
	/** The scroll container the sections live in — NOT the window. */
	readonly scrollRef: React.RefObject<HTMLElement | null>;
	readonly lang?: string;
}

/** DOM id for a category's section heading. Shared with `MenuBrowser`. */
export function categorySectionId(categoryId: string): string {
	return `menu-category-${categoryId}`;
}

export function CategoryPills({ categories, scrollRef, lang }: Readonly<CategoryPillsProps>) {
	const [activeId, setActiveId] = useState<string | null>(categories[0]?._id ?? null);
	const pillRefs = useRef(new Map<string, HTMLButtonElement>());

	useEffect(() => {
		const root = scrollRef.current;
		if (!root || categories.length === 0) return;

		const headings = categories
			.map((category) => document.getElementById(categorySectionId(category._id)))
			.filter((element): element is HTMLElement => element !== null);
		if (headings.length === 0) return;

		const observer = new IntersectionObserver(
			() => {
				// The callback's `entries` argument is deliberately unused. It
				// carries only the headings that just *crossed* the boundary, so
				// choosing from it alone sets the active pill to whichever section
				// happened to move last rather than the one actually at the top.
				// The observer is used purely as a "something moved" signal, and
				// the answer is recomputed from all of them.
				const visible = headings
					.map((heading) => ({
						id: heading.dataset.categoryId,
						top: heading.getBoundingClientRect().top,
					}))
					.filter((entry) => entry.id !== undefined);
				if (visible.length === 0) return;

				// The section whose heading is closest to the top of the
				// container without having scrolled past it; if every heading is
				// below (we are at the very top), the first one.
				const rootTop = root.getBoundingClientRect().top;
				const passed = visible.filter((entry) => entry.top - rootTop <= 8);
				const current = passed.length > 0 ? passed[passed.length - 1] : visible[0];
				setActiveId(current.id ?? null);
			},
			{
				root,
				// A band across the top of the container: a heading is "current"
				// from the moment it reaches the top until the next one does.
				rootMargin: "0px 0px -85% 0px",
				threshold: 0,
			}
		);

		for (const heading of headings) observer.observe(heading);
		return () => observer.disconnect();
	}, [categories, scrollRef]);

	// Keep the active pill in view as the diner scrolls the *page*, or a long
	// menu leaves the current section's pill somewhere off to the right.
	useEffect(() => {
		if (!activeId) return;
		pillRefs.current
			.get(activeId)
			?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
	}, [activeId]);

	if (categories.length < 2) {
		// One category is not an index, it is a label — and the whole menu is
		// already on screen.
		return null;
	}

	return (
		<nav aria-label="Menu categories" className="overflow-x-auto">
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
								onClick={() => {
									const heading = document.getElementById(categorySectionId(category._id));
									// `scroll-margin-top` on the heading is what keeps it
									// from parking behind the sticky bar — see MenuBrowser.
									heading?.scrollIntoView({ behavior: "smooth", block: "start" });
									setActiveId(category._id);
								}}
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
