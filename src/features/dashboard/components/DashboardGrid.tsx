/**
 * Renders the layout's widgets in a 12-column draggable / resizable grid via
 * `react-grid-layout` v2. Drag handle is the WidgetShell's `.dashboard-drag-handle`
 * button so clicking inside the widget body never accidentally triggers a drag.
 *
 * The container measures its own width via a ResizeObserver so the grid scales
 * with the dashboard column.
 */
import { GridLayout, type Layout, type LayoutItem } from "react-grid-layout";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { DashboardKeys } from "@/global/i18n";
import { EmptyState } from "@/global/components";
import { LayoutGrid } from "lucide-react";
import { useTranslation } from "react-i18next";
import { resolveRange } from "../utils/range";
import { getWidgetDescriptor, safeParseOptions, type WidgetRenderContext } from "../widgets";
import { WidgetShell } from "./WidgetShell";
import type {
	DashboardLayoutConfig,
	DashboardScopeKind,
	DashboardWidgetInstance,
	ResolvedRange,
} from "../types";

interface DashboardGridProps {
	readonly config: DashboardLayoutConfig;
	readonly scopeKind: DashboardScopeKind;
	readonly restaurantId: string | null;
	readonly currency: string | null;
	readonly editing: boolean;
	readonly onLayoutChange?: (next: Layout) => void;
	readonly onRemoveWidget?: (instanceId: string) => void;
}

const COLS = 12;
const ROW_HEIGHT = 60;
const MARGIN: readonly [number, number] = [12, 12];

export function DashboardGrid({
	config,
	scopeKind,
	restaurantId,
	currency,
	editing,
	onLayoutChange,
	onRemoveWidget,
}: DashboardGridProps) {
	const { t } = useTranslation();
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [width, setWidth] = useState<number>(0);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) setWidth(entry.contentRect.width);
		});
		observer.observe(el);
		setWidth(el.clientWidth);
		return () => observer.disconnect();
	}, []);

	const baseRange = resolveRange(config.globalDateRange, config.customRange);
	const compareRange: ResolvedRange | null = config.compareToPrev
		? buildPrevRange(baseRange)
		: null;

	const layout: Layout = config.widgets.map((w) => ({
		i: w.instanceId,
		x: w.gridPosition.x,
		y: w.gridPosition.y,
		w: w.gridPosition.w,
		h: w.gridPosition.h,
		isDraggable: editing,
		isResizable: editing,
	}));

	const handleLayoutChange = useCallback(
		(next: Layout) => {
			if (onLayoutChange) onLayoutChange(next);
		},
		[onLayoutChange]
	);

	return (
		<div ref={containerRef} className="flex-1 min-h-0 w-full flex flex-col">
			{config.widgets.length === 0 ? (
				<EmptyState
					icon={LayoutGrid}
					title={t(DashboardKeys.WIDGET_EMPTY)}
					description={t(DashboardKeys.EDIT_ADD_WIDGET)}
					fill
				/>
			) : (
				width > 0 && (
					<GridLayout
						layout={layout}
						width={width}
						gridConfig={{
							cols: COLS,
							rowHeight: ROW_HEIGHT,
							margin: MARGIN,
							containerPadding: [0, 0],
							maxRows: Infinity,
						}}
						dragConfig={{
							enabled: editing,
							bounded: false,
							handle: ".dashboard-drag-handle",
							threshold: 3,
						}}
						resizeConfig={{
							enabled: editing,
							handles: ["se"],
						}}
						onLayoutChange={handleLayoutChange}
					>
						{config.widgets.map((widget) =>
							renderWidgetItem({
								widget,
								scopeKind,
								restaurantId,
								currency,
								baseRange,
								compareRange,
								compareToPrev: config.compareToPrev,
								editing,
								onRemove: onRemoveWidget,
							})
						)}
					</GridLayout>
				)
			)}
		</div>
	);
}

interface RenderWidgetItemArgs {
	widget: DashboardWidgetInstance;
	scopeKind: DashboardScopeKind;
	restaurantId: string | null;
	currency: string | null;
	baseRange: ResolvedRange;
	compareRange: ResolvedRange | null;
	compareToPrev: boolean;
	editing: boolean;
	onRemove?: (instanceId: string) => void;
}

function renderWidgetItem({
	widget,
	scopeKind,
	restaurantId,
	currency,
	baseRange,
	compareRange,
	compareToPrev,
	editing,
	onRemove,
}: RenderWidgetItemArgs): ReactElement {
	const descriptor = getWidgetDescriptor(widget.widgetType);
	if (!descriptor) {
		return (
			<div key={widget.instanceId} data-grid={layoutItemFromWidget(widget, editing)}>
				<UnavailableWidget />
			</div>
		);
	}

	const range = widget.dateRangeOverride
		? resolveRange(widget.dateRangeOverride.kind, widget.dateRangeOverride.custom)
		: baseRange;
	let widgetCompareRange: ResolvedRange | null;
	if (widget.dateRangeOverride) {
		widgetCompareRange = compareToPrev ? buildPrevRange(range) : null;
	} else {
		widgetCompareRange = compareRange;
	}

	const context: WidgetRenderContext = {
		scopeKind,
		restaurantId,
		currency,
		range,
		comparisonRange: widgetCompareRange,
		compareToPrev,
	};

	const options = safeParseOptions(descriptor, widget.options);
	const Body = descriptor.Component;

	return (
		<div key={widget.instanceId} data-grid={layoutItemFromWidget(widget, editing)}>
			<WidgetShell
				descriptor={descriptor}
				hasOverride={Boolean(widget.dateRangeOverride)}
				editing={editing}
				onRemove={onRemove ? () => onRemove(widget.instanceId) : undefined}
			>
				<Body options={options} context={context} />
			</WidgetShell>
		</div>
	);
}

function layoutItemFromWidget(widget: DashboardWidgetInstance, editing: boolean): LayoutItem {
	return {
		i: widget.instanceId,
		x: widget.gridPosition.x,
		y: widget.gridPosition.y,
		w: widget.gridPosition.w,
		h: widget.gridPosition.h,
		isDraggable: editing,
		isResizable: editing,
	};
}

function UnavailableWidget() {
	const { t } = useTranslation();
	return (
		<div className="h-full rounded-lg border border-dashed border-(--border-default) flex flex-col items-center justify-center text-center px-3">
			<p className="text-xs font-medium text-foreground">
				{t(DashboardKeys.WIDGET_UNAVAILABLE_TITLE)}
			</p>
			<p className="text-[11px] text-faint-foreground mt-1">
				{t(DashboardKeys.WIDGET_UNAVAILABLE_DESCRIPTION)}
			</p>
		</div>
	);
}

function buildPrevRange(range: ResolvedRange): ResolvedRange {
	const len = range.to - range.from;
	return { from: range.from - len, to: range.from };
}

export type { GridItemProps } from "react-grid-layout";
