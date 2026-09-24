import { useScrollParent } from "@/global/hooks";
import { MenusKeys } from "@/global/i18n";
import type { Id } from "convex/_generated/dataModel";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export interface CategoryIndexEntry {
	id: Id<"menuCategories">;
	name: string;
	itemCount: number;
	selectedCount: number;
}

/** DOM id of a category card, the index's jump target. */
export const categoryAnchorId = (id: string) => `menu-category-${id}`;

/**
 * Desktop "on this page" index for the menu editor, the same pattern as the
 * restaurant settings index: a scrollspy highlights the category in view, a
 * click scrolls to it. Each entry shows its item count, or how many of its
 * items are selected while a bulk selection is active.
 */
export function CategoryIndex({
	entries,
	onJump,
	onAddCategory,
}: Readonly<{
	entries: readonly CategoryIndexEntry[];
	/** Called before scrolling, e.g. to expand a collapsed category. */
	onJump: (id: Id<"menuCategories">) => void;
	onAddCategory?: () => void;
}>) {
	const { t } = useTranslation();
	const rootRef = useRef<HTMLElement>(null);
	const scroller = useScrollParent(rootRef);
	const [active, setActive] = useState<string | undefined>(entries[0]?.id);
	/** Ignore the scrollspy while a click-initiated smooth scroll is in flight. */
	const lockUntil = useRef(0);

	useEffect(() => {
		if (!scroller) return;
		const onScroll = () => {
			if (Date.now() < lockUntil.current) return;
			const anchors = scroller.querySelectorAll<HTMLElement>("[data-category-anchor]");
			if (anchors.length === 0) return;
			// A category is current once its top passes under the sticky chrome.
			const chrome =
				Number.parseFloat(getComputedStyle(scroller).getPropertyValue("--admin-chrome-height")) ||
				0;
			const line = scroller.getBoundingClientRect().top + chrome + 24;
			let current = anchors[0].dataset.categoryAnchor;
			for (const a of anchors) {
				if (a.getBoundingClientRect().top <= line) current = a.dataset.categoryAnchor;
			}
			// The last categories can be too short to reach the line.
			if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
				current = anchors[anchors.length - 1].dataset.categoryAnchor;
			}
			setActive(current);
		};
		onScroll();
		scroller.addEventListener("scroll", onScroll, { passive: true });
		return () => scroller.removeEventListener("scroll", onScroll);
	}, [scroller]);

	const jump = (id: Id<"menuCategories">) => {
		onJump(id);
		lockUntil.current = Date.now() + 800;
		setActive(id);
		// After the expand re-renders, so the target has its full height.
		requestAnimationFrame(() =>
			document
				.getElementById(categoryAnchorId(id))
				?.scrollIntoView?.({ behavior: "smooth", block: "start" })
		);
	};

	return (
		<nav
			ref={rootRef}
			aria-label={t(MenusKeys.EDITOR_INDEX_TITLE)}
			className="sticky top-[calc(var(--admin-chrome-height,7rem)+1rem)]"
		>
			<p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint-foreground">
				{t(MenusKeys.EDITOR_INDEX_TITLE)}
			</p>
			<ul className="max-h-[calc(100dvh-var(--admin-chrome-height,7rem)-12rem)] overflow-y-auto border-l border-border">
				{entries.map((entry) => {
					const isActive = entry.id === active;
					return (
						<li key={entry.id}>
							<button
								type="button"
								onClick={() => jump(entry.id)}
								aria-current={isActive ? "location" : undefined}
								className={`-ml-px flex w-full items-center gap-2 border-l-2 py-1.5 pl-3 pr-1 text-left text-sm ${
									isActive
										? "border-foreground text-foreground"
										: "border-transparent text-muted-foreground hover:text-foreground"
								}`}
							>
								<span className="min-w-0 flex-1 truncate">{entry.name}</span>
								{entry.selectedCount > 0 ? (
									<span className="rounded-full bg-primary/20 px-1.5 text-[11px] font-medium tabular-nums text-primary">
										{entry.selectedCount}/{entry.itemCount}
									</span>
								) : (
									<span className="text-xs tabular-nums text-faint-foreground">
										{entry.itemCount}
									</span>
								)}
							</button>
						</li>
					);
				})}
			</ul>
			{onAddCategory ? (
				<button
					type="button"
					onClick={onAddCategory}
					className="mt-3 flex items-center gap-1.5 pl-3 text-xs text-faint-foreground hover:text-foreground"
				>
					<Plus size={13} aria-hidden /> {t(MenusKeys.EDITOR_ADD_CATEGORY)}
				</button>
			) : null}
			<p className="mt-6 pl-3 text-[11px] leading-relaxed text-faint-foreground">
				{t(MenusKeys.EDITOR_SELECTION_HINT)}
			</p>
		</nav>
	);
}
