import { TABLE_DRAG_PREFIX } from "@/features/restaurants/utils/tableLayout";
import { useDraggable } from "@dnd-kit/core";
import type { Doc, Id } from "convex/_generated/dataModel";
import { GripVertical, Pencil, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { TableActionsKebab } from "./TableActionsKebab";

interface DraggableTableRowProps {
	table: Doc<"tables">;
	dragHandleLabel: string;
	sectionsList: Doc<"sections">[];
	sectionLabel: (s: Doc<"sections">, idx: number) => string;
	onAssignSection: (tableId: Id<"tables">, sectionId: Id<"sections">) => void;
	onStartEdit: () => void;
	onToggleActive: () => void;
	onRemove: () => void;
	isKebabOpen: boolean;
	onOpenKebab: () => void;
	onCloseKebab: () => void;
	selectionMode?: boolean;
	isSelected?: boolean;
	onToggleSelect?: () => void;
	labels: {
		table: string;
		seatsFormat: string;
		editTitle: string;
		removeTitle: string;
		activateTitle: string;
		moveTableAria: string;
		rowActionsAria: string;
	};
}

export function DraggableTableRow(props: Readonly<DraggableTableRowProps>) {
	const {
		table,
		dragHandleLabel,
		sectionsList,
		sectionLabel,
		onAssignSection,
		onStartEdit,
		onToggleActive,
		onRemove,
		isKebabOpen,
		onOpenKebab,
		onCloseKebab,
		selectionMode = false,
		isSelected = false,
		onToggleSelect,
		labels,
	} = props;
	const draggable = useDraggable({
		id: `${TABLE_DRAG_PREFIX}:${table._id}`,
		disabled: selectionMode,
	});
	const style = {
		opacity: draggable.isDragging ? 0 : 1,
	};
	const inactive = !table.isActive;
	const rowClass = [
		"flex items-center justify-between px-4 py-3 rounded-lg bg-muted border",
		isSelected ? "border-2 border-destructive" : "border-border",
		selectionMode ? "cursor-pointer" : "",
		inactive ? "opacity-60" : "",
	]
		.filter(Boolean)
		.join(" ");

	return (
		<div
			ref={draggable.setNodeRef}
			style={style}
			className={rowClass}
			onClick={
				selectionMode
					? () => {
							onToggleSelect?.();
						}
					: undefined
			}
			onKeyDown={
				selectionMode
					? (e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								onToggleSelect?.();
							}
						}
					: undefined
			}
			role={selectionMode ? "button" : undefined}
			tabIndex={selectionMode ? 0 : undefined}
			aria-pressed={selectionMode ? isSelected : undefined}
		>
			<div className="flex items-center gap-3 min-w-0">
				{selectionMode ? (
					<span className="p-1 text-faint-foreground" aria-hidden>
						<GripVertical size={16} />
					</span>
				) : (
					<button
						type="button"
						className="p-1 rounded text-faint-foreground hover:text-foreground hover:bg-hover cursor-grab active:cursor-grabbing touch-none"
						title={dragHandleLabel}
						aria-label={dragHandleLabel}
						{...draggable.attributes}
						{...draggable.listeners}
					>
						<GripVertical size={16} />
					</button>
				)}
				<span className={`text-sm font-medium text-foreground ${inactive ? "line-through" : ""}`}>
					{labels.table}
				</span>
				{table.label && (
					<span className="text-xs text-faint-foreground truncate">{table.label}</span>
				)}
				<span className="text-xs text-faint-foreground">{labels.seatsFormat}</span>
			</div>
			{selectionMode ? null : (
				<div className="flex items-center gap-2">
					<select
						value={table.sectionId ?? ""}
						onChange={(e) => onAssignSection(table._id, e.target.value as Id<"sections">)}
						className="md:hidden px-2 py-1 rounded-md bg-background border border-border text-xs text-foreground"
						aria-label={labels.moveTableAria}
						title={labels.moveTableAria}
					>
						{sectionsList.map((s, idx) => (
							<option key={s._id} value={s._id}>
								{sectionLabel(s, idx)}
							</option>
						))}
					</select>
					<TableActionsKebab
						isOpen={isKebabOpen}
						onOpen={onOpenKebab}
						onClose={onCloseKebab}
						ariaLabel={labels.rowActionsAria}
						items={
							<>
								<button
									type="button"
									onClick={() => {
										onCloseKebab();
										onStartEdit();
									}}
									className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-hover text-sm text-foreground w-full text-left"
								>
									<Pencil size={14} />
									{labels.editTitle}
								</button>
								<button
									type="button"
									onClick={() => {
										onCloseKebab();
										onToggleActive();
									}}
									className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-hover text-sm text-foreground w-full text-left"
								>
									{table.isActive ? (
										<ToggleRight size={14} className="text-success" />
									) : (
										<ToggleLeft size={14} className="text-faint-foreground" />
									)}
									{labels.activateTitle}
								</button>
								<button
									type="button"
									onClick={() => {
										onCloseKebab();
										onRemove();
									}}
									className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-hover text-sm text-destructive w-full text-left"
								>
									<Trash2 size={14} />
									{labels.removeTitle}
								</button>
							</>
						}
					/>
				</div>
			)}
		</div>
	);
}
