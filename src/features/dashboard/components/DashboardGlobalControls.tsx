/**
 * The header bar above the widget grid: date-range segmented control plus a
 * compare-to-previous toggle. Changes propagate via callbacks so the parent
 * page can persist them through `dashboardLayouts.update`.
 */
import { SegmentedControl } from "@/global/components";
import { DashboardKeys } from "@/global/i18n";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DashboardRangeKind } from "../types";

interface DashboardGlobalControlsProps {
	rangeKind: DashboardRangeKind;
	compareToPrev: boolean;
	onRangeChange: (next: DashboardRangeKind) => void;
	onCompareToggle: (next: boolean) => void;
}

const RANGE_KINDS: ReadonlyArray<{ value: DashboardRangeKind; key: string }> = [
	{ value: "today", key: DashboardKeys.GLOBAL_RANGE_TODAY },
	{ value: "week", key: DashboardKeys.GLOBAL_RANGE_WEEK },
	{ value: "month", key: DashboardKeys.GLOBAL_RANGE_MONTH },
	{ value: "quarter", key: DashboardKeys.GLOBAL_RANGE_QUARTER },
	{ value: "year", key: DashboardKeys.GLOBAL_RANGE_YEAR },
];

export function DashboardGlobalControls({
	rangeKind,
	compareToPrev,
	onRangeChange,
	onCompareToggle,
}: DashboardGlobalControlsProps) {
	const { t } = useTranslation();
	const rangeOptions = useMemo(
		() =>
			RANGE_KINDS.map((r) => ({
				value: r.value,
				label: t(r.key),
			})),
		[t]
	);

	return (
		<div className="flex flex-wrap items-center gap-3">
			<SegmentedControl<DashboardRangeKind>
				options={rangeOptions}
				value={rangeKind === "custom" ? "today" : rangeKind}
				onChange={onRangeChange}
				ariaLabel={t(DashboardKeys.GLOBAL_RANGE_LABEL)}
			/>
			<label className="flex items-center gap-2 text-xs text-foreground cursor-pointer select-none">
				<input
					type="checkbox"
					checked={compareToPrev}
					onChange={(e) => onCompareToggle(e.target.checked)}
					className="h-3.5 w-3.5 rounded border-(--border-default)"
					aria-label={t(DashboardKeys.GLOBAL_COMPARE_TO_PREV_LABEL)}
				/>
				<span>{t(DashboardKeys.GLOBAL_COMPARE_TO_PREV)}</span>
			</label>
		</div>
	);
}
