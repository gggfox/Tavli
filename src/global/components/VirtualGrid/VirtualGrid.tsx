/**
 * VirtualGrid — responsive card grid that only mounts the rows in view.
 *
 * The staff dashboards (open orders, open tabs) render one card per record in
 * a `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` grid. On a busy service that
 * is hundreds of live-updating cards, all mounted, all re-rendering on every
 * Convex push. This keeps the same visual grid but mounts only the visible
 * rows plus `overscan`.
 *
 * Two deliberate design choices:
 *
 *  - It scrolls the *existing* ancestor scroll container (`useScrollParent`)
 *    instead of introducing its own. Nesting a second scroller inside
 *    `AdminPageLayout` would give the page two scrollbars and detach the
 *    sticky toolbar.
 *  - Column count comes from `matchMedia` on the Tailwind breakpoints, not
 *    from the container width, because the grid classes it replaces were
 *    viewport-based. Track sizing is inline (`repeat(n, minmax(0,1fr))`) so
 *    the column count and the layout can never disagree.
 *
 * Row heights are measured, not assumed — cards vary with their content.
 */
import { useMediaQuery } from "@/global/hooks/useMediaQuery";
import { useScrollMargin, useScrollParent } from "@/global/hooks/useScrollParent";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, type ReactNode } from "react";

export interface VirtualGridProps<T> {
	readonly items: readonly T[];
	readonly getKey: (item: T, index: number) => string;
	readonly renderItem: (item: T, index: number) => ReactNode;
	/** Columns at `base` / `md` (>=768px) / `lg` (>=1024px). */
	readonly columns?: { readonly base: number; readonly md: number; readonly lg: number };
	/** Gap between cards, in pixels. Matches Tailwind's `gap-3` / `gap-4`. */
	readonly gap?: number;
	/** First-pass row height guess; real heights are measured after mount. */
	readonly estimateRowHeight?: number;
	readonly overscan?: number;
	readonly className?: string;
}

const DEFAULT_COLUMNS = { base: 1, md: 2, lg: 3 } as const;

export function VirtualGrid<T>({
	items,
	getKey,
	renderItem,
	columns = DEFAULT_COLUMNS,
	gap = 16,
	estimateRowHeight = 220,
	overscan = 3,
	className = "",
}: VirtualGridProps<T>) {
	const containerRef = useRef<HTMLDivElement>(null);
	const scrollParent = useScrollParent(containerRef);
	const scrollMargin = useScrollMargin(containerRef, scrollParent);

	const isMdUp = useMediaQuery("(min-width: 768px)");
	const isLgUp = useMediaQuery("(min-width: 1024px)");
	let columnCount = columns.base;
	if (isLgUp) columnCount = columns.lg;
	else if (isMdUp) columnCount = columns.md;

	const rows = useMemo(() => {
		const chunked: T[][] = [];
		for (let i = 0; i < items.length; i += columnCount) {
			chunked.push(items.slice(i, i + columnCount) as T[]);
		}
		return chunked;
	}, [items, columnCount]);

	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scrollParent,
		estimateSize: () => estimateRowHeight + gap,
		overscan,
		scrollMargin,
	});

	const virtualRows = virtualizer.getVirtualItems();

	return (
		<div
			ref={containerRef}
			className={className}
			style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}
		>
			{virtualRows.map((virtualRow) => {
				const row = rows[virtualRow.index];
				return (
					<div
						key={virtualRow.key}
						data-index={virtualRow.index}
						ref={virtualizer.measureElement}
						style={{
							position: "absolute",
							top: 0,
							left: 0,
							width: "100%",
							transform: `translateY(${virtualRow.start - scrollMargin}px)`,
							display: "grid",
							gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
							gap,
							paddingBottom: gap,
						}}
					>
						{row.map((item, columnIndex) => {
							const itemIndex = virtualRow.index * columnCount + columnIndex;
							return <div key={getKey(item, itemIndex)}>{renderItem(item, itemIndex)}</div>;
						})}
					</div>
				);
			})}
		</div>
	);
}
