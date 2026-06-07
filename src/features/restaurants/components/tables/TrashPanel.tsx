import { formatRemaining } from "@/features/restaurants/utils/tableLayout";
import { RestaurantsKeys } from "@/global/i18n";
import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Doc, Id } from "convex/_generated/dataModel";

interface TrashPanelProps {
	show: boolean;
	onToggle: () => void;
	deletedSections: Doc<"sections">[];
	deletedTables: Doc<"tables">[];
	onRestoreSection: (id: Id<"sections">) => void;
	onRestoreTable: (id: Id<"tables">) => void;
	sectionLabel: (s: Doc<"sections">, idx: number) => string;
}

export function TrashPanel({
	show,
	onToggle,
	deletedSections,
	deletedTables,
	onRestoreSection,
	onRestoreTable,
	sectionLabel,
}: Readonly<TrashPanelProps>) {
	const { t } = useTranslation();
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!show) return;
		const interval = setInterval(() => setNow(Date.now()), 60_000);
		return () => clearInterval(interval);
	}, [show]);

	const hasDeleted = deletedSections.length > 0 || deletedTables.length > 0;
	// Tables soft-deleted as part of a section cascade are grouped under the
	// parent section row instead of getting their own row; only standalone
	// table deletes appear here.
	const independentlyDeletedTables = useMemo(
		() => deletedTables.filter((tb) => tb.softDeleteParentSectionId === undefined),
		[deletedTables]
	);

	return (
		<div className="space-y-3">
			<div className="flex justify-end">
				<button
					type="button"
					onClick={onToggle}
					className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-hover text-faint-foreground"
				>
					{show
						? t(RestaurantsKeys.TABLES_HIDE_RECENTLY_DELETED)
						: t(RestaurantsKeys.TABLES_SHOW_RECENTLY_DELETED)}
				</button>
			</div>
			{show && (
				<div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
					{!hasDeleted ? (
						<p className="text-xs text-faint-foreground">{t(RestaurantsKeys.TABLES_TRASH_EMPTY)}</p>
					) : (
						<>
							{deletedSections.map((section, idx) => {
								const childTables = deletedTables.filter(
									(tb) => tb.softDeleteParentSectionId === section._id
								);
								return (
									<TrashRow
										key={section._id}
										title={sectionLabel(section, idx)}
										subtitle={t(RestaurantsKeys.SECTIONS_TABLE_COUNT_SHORT, {
											count: childTables.length,
										})}
										purgesInLabel={
											section.hardDeleteAfterAt
												? t(RestaurantsKeys.SECTIONS_PURGES_IN, {
														time: formatRemaining(section.hardDeleteAfterAt - now),
													})
												: ""
										}
										restoreLabel={t(RestaurantsKeys.SECTIONS_RESTORE)}
										onRestore={() => onRestoreSection(section._id)}
									/>
								);
							})}
							{independentlyDeletedTables.map((table) => (
								<TrashRow
									key={table._id}
									title={t(RestaurantsKeys.TABLES_TABLE_LABEL, {
										number: table.tableNumber,
									})}
									subtitle={
										table.capacity !== undefined
											? t(RestaurantsKeys.TABLES_SEATS_FORMAT, { count: table.capacity })
											: ""
									}
									purgesInLabel={
										table.hardDeleteAfterAt
											? t(RestaurantsKeys.TABLES_PURGES_IN, {
													time: formatRemaining(table.hardDeleteAfterAt - now),
												})
											: ""
									}
									restoreLabel={t(RestaurantsKeys.TABLES_RESTORE)}
									onRestore={() => onRestoreTable(table._id)}
								/>
							))}
						</>
					)}
				</div>
			)}
		</div>
	);
}

interface TrashRowProps {
	title: string;
	subtitle: string;
	purgesInLabel: string;
	restoreLabel: string;
	onRestore: () => void;
}

function TrashRow({
	title,
	subtitle,
	purgesInLabel,
	restoreLabel,
	onRestore,
}: Readonly<TrashRowProps>) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
			<div className="min-w-0 space-y-0.5">
				<div className="font-medium text-foreground line-through">{title}</div>
				<div className="text-xs text-faint-foreground">
					{subtitle && <span>{subtitle}</span>}
					{subtitle && purgesInLabel && <span> · </span>}
					{purgesInLabel && <span>{purgesInLabel}</span>}
				</div>
			</div>
			<button
				type="button"
				onClick={onRestore}
				className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-hover"
			>
				<RotateCcw size={14} />
				{restoreLabel}
			</button>
		</div>
	);
}
