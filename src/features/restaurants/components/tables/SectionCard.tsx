import { SECTION_DRAG_PREFIX, SECTION_DROP_PREFIX } from "@/features/restaurants/utils/tableLayout";
import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Doc } from "convex/_generated/dataModel";
import { Eye, EyeOff, GripVertical, Pencil, Trash2 } from "lucide-react";
import { type ReactElement } from "react";
import { SectionRenameInline } from "./SectionRenameInline";

interface SectionCardProps {
	section: Doc<"sections">;
	isEditing: boolean;
	initialRenameValue: string;
	tables: Doc<"tables">[];
	isDraggingTable: boolean;
	sectionLabel: string;
	translations: {
		tableCount: string;
		dropHere: string;
		renameTitle: string;
		deleteTitle: string;
		save: string;
		cancel: string;
		dragHandle: string;
		renamePlaceholder: string;
		hideTitle: string;
		showTitle: string;
		hiddenBadge: string;
	};
	onStartRename: () => void;
	onCancelRename: () => void;
	onSubmitRename: (name: string) => void;
	onRemove: () => void;
	onToggleHidden: () => void;
	renderTableRow: (table: Doc<"tables">) => ReactElement;
}

export function SectionCard(props: Readonly<SectionCardProps>) {
	const {
		section,
		isEditing,
		initialRenameValue,
		tables,
		isDraggingTable,
		sectionLabel,
		translations,
		onStartRename,
		onCancelRename,
		onSubmitRename,
		onRemove,
		onToggleHidden,
		renderTableRow,
	} = props;

	const sortableId = `${SECTION_DRAG_PREFIX}:${section._id}`;
	const sortable = useSortable({ id: sortableId });
	const dropTarget = useDroppable({ id: `${SECTION_DROP_PREFIX}:${section._id}` });

	const style = {
		transform: CSS.Transform.toString(sortable.transform),
		transition: sortable.transition,
		// Hide the source card while dragging — the DragOverlay clone follows
		// the cursor.
		opacity: sortable.isDragging ? 0 : 1,
	};

	const isOverForTable = isDraggingTable && (sortable.isOver || dropTarget.isOver);
	const outlineClass = isOverForTable
		? "border-2 border-dashed border-primary"
		: "border-2 border-dashed border-border";
	const isHidden = section.isActive === false;

	if (isHidden) {
		return (
			<div
				ref={sortable.setNodeRef}
				style={style}
				className={`rounded-xl ${outlineClass} bg-background/40 p-3 flex items-center gap-2 min-w-0 opacity-75`}
			>
				<button
					type="button"
					className="p-1 rounded text-faint-foreground hover:text-foreground hover:bg-hover cursor-grab active:cursor-grabbing touch-none shrink-0"
					title={translations.dragHandle}
					aria-label={translations.dragHandle}
					{...sortable.attributes}
					{...sortable.listeners}
				>
					<GripVertical size={16} />
				</button>
				<h4
					className="text-sm font-medium text-faint-foreground truncate min-w-0"
					title={sectionLabel}
				>
					{sectionLabel}
				</h4>
				<span className="text-xs text-faint-foreground shrink-0">{translations.tableCount}</span>
				<span className="text-xs px-1.5 py-0.5 rounded-md bg-muted text-faint-foreground shrink-0">
					{translations.hiddenBadge}
				</span>
				<div className="ml-auto flex items-center gap-1 shrink-0">
					<button
						type="button"
						onClick={onToggleHidden}
						className="p-1.5 rounded-md hover:bg-hover text-muted-foreground"
						title={translations.showTitle}
						aria-label={translations.showTitle}
					>
						<EyeOff size={14} />
					</button>
				</div>
			</div>
		);
	}

	return (
		<div
			ref={sortable.setNodeRef}
			style={style}
			className={`rounded-xl ${outlineClass} bg-background/50 p-3 flex flex-col gap-3`}
		>
			<div className="flex items-center gap-2 min-w-0">
				<button
					type="button"
					className="p-1 rounded text-faint-foreground hover:text-foreground hover:bg-hover cursor-grab active:cursor-grabbing touch-none shrink-0"
					title={translations.dragHandle}
					aria-label={translations.dragHandle}
					{...sortable.attributes}
					{...sortable.listeners}
				>
					<GripVertical size={16} />
				</button>
				{isEditing ? (
					<SectionRenameInline
						key={`rename-${section._id}`}
						initialValue={initialRenameValue}
						placeholder={translations.renamePlaceholder}
						saveLabel={translations.save}
						cancelLabel={translations.cancel}
						onSubmit={onSubmitRename}
						onCancel={onCancelRename}
					/>
				) : (
					<>
						<h4
							className="text-sm font-semibold text-foreground truncate min-w-0"
							title={sectionLabel}
						>
							{sectionLabel}
						</h4>
						<span className="text-xs text-faint-foreground shrink-0">
							{translations.tableCount}
						</span>
						<div className="ml-auto flex items-center gap-1 shrink-0">
							<button
								onClick={onToggleHidden}
								className="p-1.5 rounded-md hover:bg-hover text-muted-foreground"
								title={translations.hideTitle}
								aria-label={translations.hideTitle}
							>
								<Eye size={14} />
							</button>
							<button
								onClick={onStartRename}
								className="p-1.5 rounded-md hover:bg-hover text-muted-foreground"
								title={translations.renameTitle}
							>
								<Pencil size={14} />
							</button>
							<button
								onClick={onRemove}
								className="p-1.5 rounded-md hover:bg-hover text-destructive"
								title={translations.deleteTitle}
							>
								<Trash2 size={14} />
							</button>
						</div>
					</>
				)}
			</div>

			<div
				ref={dropTarget.setNodeRef}
				className="flex-1 flex flex-col gap-2"
				aria-label={section.name ?? sectionLabel}
			>
				{tables.length === 0 ? (
					<div
						className={`flex-1 flex items-center justify-center rounded-lg text-center text-xs border border-dashed ${
							isOverForTable
								? "border-primary text-primary"
								: "border-border/60 text-faint-foreground"
						}`}
					>
						{translations.dropHere}
					</div>
				) : (
					tables.map((table) => renderTableRow(table))
				)}
			</div>
		</div>
	);
}
