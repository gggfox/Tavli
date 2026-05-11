/**
 * Toggle between "this restaurant" and "all my restaurants" (portfolio).
 * Only renders when the user has more than one restaurant; in that case
 * portfolio layouts become a separate set of layouts with their own tabs.
 */
import { SegmentedControl } from "@/global/components";
import { DashboardKeys } from "@/global/i18n";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DashboardScopeKind } from "../types";

interface DashboardScopeSwitcherProps {
	value: DashboardScopeKind;
	onChange: (next: DashboardScopeKind) => void;
	restaurantLabel: string;
}

export function DashboardScopeSwitcher({
	value,
	onChange,
	restaurantLabel,
}: DashboardScopeSwitcherProps) {
	const { t } = useTranslation();
	const options = useMemo(
		() => [
			{ value: "restaurant" as const, label: restaurantLabel },
			{
				value: "portfolio" as const,
				label: t(DashboardKeys.PAGE_PORTFOLIO_LABEL),
			},
		],
		[t, restaurantLabel]
	);

	return (
		<SegmentedControl<DashboardScopeKind>
			options={options}
			value={value}
			onChange={onChange}
			ariaLabel={t(DashboardKeys.PAGE_TITLE)}
			size="sm"
		/>
	);
}
