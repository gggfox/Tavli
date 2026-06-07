import { RestaurantsKeys } from "@/global/i18n";
import { useTranslation } from "react-i18next";

interface InactiveTablesBarProps {
	inactiveCount: number;
	showInactive: boolean;
	onToggle: () => void;
}

export function InactiveTablesBar({
	inactiveCount,
	showInactive,
	onToggle,
}: Readonly<InactiveTablesBarProps>) {
	const { t } = useTranslation();

	if (inactiveCount === 0) return null;

	return (
		<div className="sticky bottom-0 z-10 -mx-6 px-6 py-3 bg-background border-t border-border flex justify-end">
			<button
				type="button"
				onClick={onToggle}
				className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-hover text-faint-foreground"
			>
				{showInactive
					? t(RestaurantsKeys.TABLES_HIDE_INACTIVE)
					: t(RestaurantsKeys.TABLES_SHOW_INACTIVE, { count: inactiveCount })}
			</button>
		</div>
	);
}
