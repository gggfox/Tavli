import { RestaurantsKeys } from "@/global/i18n";
import { GripVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Doc } from "convex/_generated/dataModel";

interface TableDragGhostProps {
	table: Doc<"tables">;
}

export function TableDragGhost({ table }: Readonly<TableDragGhostProps>) {
	const { t } = useTranslation();
	return (
		<div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-muted border border-border shadow-lg">
			<GripVertical size={16} className="text-faint-foreground" />
			<span className="text-sm font-medium text-foreground">
				{t(RestaurantsKeys.TABLES_TABLE_LABEL, { number: table.tableNumber })}
			</span>
			{table.label && <span className="text-xs text-faint-foreground truncate">{table.label}</span>}
		</div>
	);
}

interface SectionDragGhostProps {
	label: string;
	countText: string;
}

export function SectionDragGhost({ label, countText }: Readonly<SectionDragGhostProps>) {
	return (
		<div className="rounded-xl border-2 border-dashed border-border bg-background/95 p-3 shadow-lg w-64">
			<div className="flex items-center gap-2">
				<GripVertical size={16} className="text-faint-foreground" />
				<h4 className="text-sm font-semibold text-foreground truncate" title={label}>
					{label}
				</h4>
				<span className="text-xs text-faint-foreground">{countText}</span>
			</div>
		</div>
	);
}
