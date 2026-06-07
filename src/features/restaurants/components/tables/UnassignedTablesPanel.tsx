import { RestaurantsKeys } from "@/global/i18n";
import type { Doc } from "convex/_generated/dataModel";
import { type ReactElement } from "react";
import { useTranslation } from "react-i18next";

interface UnassignedTablesPanelProps {
	tables: Doc<"tables">[];
	renderTableRow: (table: Doc<"tables">) => ReactElement;
}

export function UnassignedTablesPanel({
	tables,
	renderTableRow,
}: Readonly<UnassignedTablesPanelProps>) {
	const { t } = useTranslation();

	if (tables.length === 0) return null;

	return (
		<div className="space-y-2">
			<h4 className="text-sm font-semibold text-foreground">
				{t(RestaurantsKeys.SECTIONS_UNNAMED, { number: 0 })}
			</h4>
			<div className="space-y-2">{tables.map((table) => renderTableRow(table))}</div>
		</div>
	);
}
