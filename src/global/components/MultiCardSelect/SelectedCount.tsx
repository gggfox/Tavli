import { CommonKeys } from "@/global/i18n";
import { useTranslation } from "react-i18next";

type SelectedCountProps = Readonly<{
	selectedIds: string[];
}>;
export function SelectedCount({ selectedIds }: SelectedCountProps) {
	const { t } = useTranslation();
	if (selectedIds.length === 0) {
		return <div className="hidden"></div>;
	}
	return (
		<div className="pt-2 border-t border border-border">
			<p className="text-xs text-faint-foreground">
				{t(CommonKeys.SELECT_SELECTED_COUNT, { count: selectedIds.length })}
			</p>
		</div>
	);
}
