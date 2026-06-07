import { RestaurantsKeys } from "@/global/i18n";
import { useTranslation } from "react-i18next";

interface TablesToolbarProps {
	hasTables: boolean;
	selectionMode: boolean;
	selectedCount: number;
	onToggleSelectionMode: (enabled: boolean) => void;
	onBulkDelete: () => void;
	onCancelSelection: () => void;
}

export function TablesToolbar({
	hasTables,
	selectionMode,
	selectedCount,
	onToggleSelectionMode,
	onBulkDelete,
	onCancelSelection,
}: Readonly<TablesToolbarProps>) {
	const { t } = useTranslation();

	if (!hasTables) return null;

	return (
		<div className="flex flex-wrap items-center gap-3">
			<label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
				<input
					type="checkbox"
					checked={selectionMode}
					onChange={(e) => onToggleSelectionMode(e.target.checked)}
					className="h-4 w-4 rounded border-border accent-[var(--btn-primary-bg)]"
				/>
				{t(RestaurantsKeys.TABLES_SELECT_MODE)}
			</label>
			{selectionMode ? (
				<>
					<button
						type="button"
						disabled={selectedCount === 0}
						onClick={onBulkDelete}
						className="px-3 py-1.5 rounded-md text-sm font-medium text-destructive border border-border hover:bg-hover disabled:opacity-50 disabled:pointer-events-none"
					>
						{t(RestaurantsKeys.TABLES_BULK_REMOVE, { count: selectedCount })}
					</button>
					<button
						type="button"
						onClick={onCancelSelection}
						className="px-3 py-1.5 rounded-md text-sm font-medium border border-border hover:bg-hover"
					>
						{t(RestaurantsKeys.TABLES_BULK_CANCEL)}
					</button>
				</>
			) : null}
		</div>
	);
}
