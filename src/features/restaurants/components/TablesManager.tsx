import { BulkDeleteConfirmModal } from "@/features/restaurants/components/tables/BulkDeleteConfirmModal";
import { DraggableTableRow } from "@/features/restaurants/components/tables/DraggableTableRow";
import { InactiveTablesBar } from "@/features/restaurants/components/tables/InactiveTablesBar";
import { NewSectionForm } from "@/features/restaurants/components/tables/NewSectionForm";
import { NewTableForm } from "@/features/restaurants/components/tables/NewTableForm";
import { SectionCard } from "@/features/restaurants/components/tables/SectionCard";
import { SectionDeleteConfirmModal } from "@/features/restaurants/components/tables/SectionDeleteConfirmModal";
import { TableEditRow } from "@/features/restaurants/components/tables/TableEditRow";
import { TablesToolbar } from "@/features/restaurants/components/tables/TablesToolbar";
import { TrashPanel } from "@/features/restaurants/components/tables/TrashPanel";
import { UnassignedTablesPanel } from "@/features/restaurants/components/tables/UnassignedTablesPanel";
import { useFloorPlan } from "@/features/restaurants/hooks/useFloorPlan";
import { useTableMutationError } from "@/features/restaurants/hooks/useTableMutationError";
import { useTablesDnd } from "@/features/restaurants/hooks/useTablesDnd";
import { InlineError } from "@/global/components";
import { RestaurantsKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils";
import { closestCenter, DndContext, DragOverlay } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import type { Doc, Id } from "convex/_generated/dataModel";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";

interface TablesManagerProps {
	restaurantId: Id<"restaurants">;
}

export function TablesManager({ restaurantId }: Readonly<TablesManagerProps>) {
	const { t } = useTranslation();
	const [showTrash, setShowTrash] = useState(false);
	const [showInactive, setShowInactive] = useState(false);

	const { error, clearError, setMutationError } = useTableMutationError();

	const floorPlan = useFloorPlan(restaurantId, { showTrash, showInactive });
	const {
		tables,
		sectionsList,
		deletedTables,
		deletedSections,
		sectionLabel,
		inactiveCount,
		visibleTableIds,
		nextTableNumber,
		buildTablesBySection,
		createTable,
		updateTable,
		toggleActive,
		removeTable,
		bulkRemoveTables,
		restoreTable,
		createSection,
		updateSection,
		removeSection,
		restoreSection,
		assignTableSection,
		isBulkRemovePending,
	} = floorPlan;

	const [editingId, setEditingId] = useState<Id<"tables"> | null>(null);
	const [editingSectionId, setEditingSectionId] = useState<Id<"sections"> | null>(null);
	const [confirmDeleteSectionId, setConfirmDeleteSectionId] = useState<Id<"sections"> | null>(null);
	const [openKebab, setOpenKebab] = useState<Id<"tables"> | null>(null);
	const [selectionMode, setSelectionMode] = useState(false);
	const [selectedTableIds, setSelectedTableIds] = useState(() => new Set<Id<"tables">>());
	const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

	const closeKebab = useCallback(() => setOpenKebab(null), []);

	const dnd = useTablesDnd({
		tables,
		sectionsList,
		buildTablesBySection,
		sectionLabel,
		assignTableSection,
		updateSection,
		setMutationError,
		clearError,
		selectionMode,
		onCloseKebab: closeKebab,
	});

	const tableIdsFingerprint = useMemo(
		() =>
			tables
				.map((tt) => tt._id)
				.sort()
				.join(","),
		[tables]
	);

	useEffect(() => {
		const valid = new Set(tableIdsFingerprint.split(",").filter(Boolean));
		setSelectedTableIds((prev) => {
			let changed = false;
			const next = new Set<Id<"tables">>();
			for (const id of prev) {
				if (valid.has(id) && visibleTableIds.has(id)) next.add(id);
				else changed = true;
			}
			return changed ? next : prev;
		});
	}, [tableIdsFingerprint, visibleTableIds]);

	const cancelEdit = () => setEditingId(null);
	const cancelSectionEdit = () => setEditingSectionId(null);

	const toggleSelectionMode = (enabled: boolean) => {
		clearError();
		if (enabled && editingId !== null) setEditingId(null);
		setSelectionMode(enabled);
		if (!enabled) {
			setSelectedTableIds(new Set());
			setConfirmBulkDelete(false);
		}
		setOpenKebab(null);
	};

	const toggleTableSelected = (tableId: Id<"tables">) => {
		if (!visibleTableIds.has(tableId)) return;
		setSelectedTableIds((prev) => {
			const next = new Set(prev);
			if (next.has(tableId)) next.delete(tableId);
			else next.add(tableId);
			return next;
		});
	};

	const handleToggleActive = async (tableId: Id<"tables">) => {
		clearError();
		try {
			unwrapResult(await toggleActive({ tableId }));
		} catch (err) {
			setMutationError(err, RestaurantsKeys.TABLES_TOGGLE_FAILED);
		}
	};

	const handleRemoveTable = async (tableId: Id<"tables">) => {
		clearError();
		try {
			unwrapResult(await removeTable({ tableId }));
		} catch (err) {
			setMutationError(err, RestaurantsKeys.TABLES_REMOVE_FAILED);
		}
	};

	const handleConfirmBulkDelete = async () => {
		const tableIds = [...selectedTableIds];
		if (tableIds.length === 0) return;
		clearError();
		setConfirmBulkDelete(false);
		try {
			unwrapResult(await bulkRemoveTables({ restaurantId, tableIds }));
			toggleSelectionMode(false);
		} catch (err) {
			setMutationError(err, RestaurantsKeys.TABLES_BULK_REMOVE_FAILED);
		}
	};

	const handleRestoreTable = async (tableId: Id<"tables">) => {
		clearError();
		try {
			unwrapResult(await restoreTable({ tableId }));
		} catch (err) {
			setMutationError(err, RestaurantsKeys.TABLES_RESTORE_FAILED);
		}
	};

	const handleConfirmDeleteSection = async () => {
		if (!confirmDeleteSectionId) return;
		clearError();
		const sectionId = confirmDeleteSectionId;
		setConfirmDeleteSectionId(null);
		try {
			unwrapResult(await removeSection({ sectionId }));
		} catch (err) {
			setMutationError(err, RestaurantsKeys.SECTIONS_REMOVE_FAILED);
		}
	};

	const handleRestoreSection = async (sectionId: Id<"sections">) => {
		clearError();
		try {
			unwrapResult(await restoreSection({ sectionId }));
		} catch (err) {
			setMutationError(err, RestaurantsKeys.SECTIONS_RESTORE_FAILED);
		}
	};

	const handleSectionHiddenToggle = async (section: Doc<"sections">) => {
		clearError();
		try {
			unwrapResult(
				await updateSection({
					sectionId: section._id,
					isActive: section.isActive === false,
				})
			);
		} catch (err) {
			setMutationError(err, RestaurantsKeys.SECTIONS_UPDATE_FAILED);
		}
	};

	const handleSectionRename = async (sectionId: Id<"sections">, nextName: string) => {
		clearError();
		try {
			unwrapResult(await updateSection({ sectionId, name: nextName }));
			setEditingSectionId(null);
		} catch (err) {
			setMutationError(err, RestaurantsKeys.SECTIONS_UPDATE_FAILED);
		}
	};

	const handleTableEdit = async (
		tableId: Id<"tables">,
		next: { tableNumber: number; capacity: number | undefined }
	) => {
		clearError();
		try {
			unwrapResult(
				await updateTable({
					tableId,
					tableNumber: next.tableNumber,
					capacity: next.capacity,
				})
			);
			cancelEdit();
		} catch (err) {
			setMutationError(err, RestaurantsKeys.TABLES_UPDATE_FAILED);
		}
	};

	const confirmDeleteSection = useMemo(
		() =>
			confirmDeleteSectionId
				? sectionsList.find((s) => s._id === confirmDeleteSectionId)
				: undefined,
		[confirmDeleteSectionId, sectionsList]
	);

	const confirmDeleteTablesCount = useMemo(
		() =>
			confirmDeleteSectionId
				? (dnd.tablesBySection.byId.get(confirmDeleteSectionId) ?? []).length
				: 0,
		[confirmDeleteSectionId, dnd.tablesBySection]
	);

	const confirmDeleteBody = useMemo(() => {
		if (confirmDeleteTablesCount === 0) {
			return t(RestaurantsKeys.SECTIONS_CONFIRM_DELETE_BODY_EMPTY);
		}
		if (confirmDeleteTablesCount === 1) {
			return t(RestaurantsKeys.SECTIONS_CONFIRM_DELETE_BODY_ONE);
		}
		return t(RestaurantsKeys.SECTIONS_CONFIRM_DELETE_BODY_OTHER, {
			count: confirmDeleteTablesCount,
		});
	}, [confirmDeleteTablesCount, t]);

	const confirmDeleteSectionDisplayName = useMemo(() => {
		if (!confirmDeleteSection) return "";
		if (confirmDeleteSection.name) return confirmDeleteSection.name;
		const idx = dnd.orderedSections.findIndex((s) => s._id === confirmDeleteSection._id);
		return t(RestaurantsKeys.SECTIONS_UNNAMED, { number: idx + 1 });
	}, [confirmDeleteSection, dnd.orderedSections, t]);

	const renderTableRow = (table: Doc<"tables">): ReactElement => {
		if (editingId === table._id) {
			return (
				<TableEditRow
					key={table._id}
					table={table}
					onSubmit={(next) => handleTableEdit(table._id, next)}
					onCancel={cancelEdit}
					labels={{
						numberLabel: t(RestaurantsKeys.TABLES_NUMBER_LABEL),
						seatsLabel: t(RestaurantsKeys.TABLES_SEATS_LABEL),
						save: t(RestaurantsKeys.TABLES_SAVE),
						cancel: t(RestaurantsKeys.TABLES_CANCEL),
					}}
				/>
			);
		}
		const isVisible = showInactive || table.isActive;
		return (
			<DraggableTableRow
				key={table._id}
				table={table}
				dragHandleLabel={t(RestaurantsKeys.TABLES_DRAG_HANDLE)}
				sectionsList={sectionsList}
				sectionLabel={sectionLabel}
				onAssignSection={dnd.handleMoveTableToSection}
				onStartEdit={() => {
					clearError();
					setEditingId(table._id);
					setOpenKebab(null);
				}}
				onToggleActive={() => handleToggleActive(table._id)}
				onRemove={() => handleRemoveTable(table._id)}
				isKebabOpen={openKebab === table._id}
				onOpenKebab={() => setOpenKebab(table._id)}
				onCloseKebab={closeKebab}
				selectionMode={selectionMode && isVisible}
				isSelected={selectedTableIds.has(table._id)}
				onToggleSelect={() => toggleTableSelected(table._id)}
				labels={{
					table: t(RestaurantsKeys.TABLES_TABLE_LABEL, { number: table.tableNumber }),
					seatsFormat:
						table.capacity !== undefined
							? t(RestaurantsKeys.TABLES_SEATS_FORMAT, { count: table.capacity })
							: t(RestaurantsKeys.TABLES_SEATS_NOT_SET),
					editTitle: t(RestaurantsKeys.TABLES_EDIT_TITLE),
					removeTitle: t(RestaurantsKeys.TABLES_REMOVE_TITLE),
					activateTitle: table.isActive
						? t(RestaurantsKeys.TABLES_DEACTIVATE_TITLE)
						: t(RestaurantsKeys.TABLES_ACTIVATE_TITLE),
					moveTableAria: t(RestaurantsKeys.SECTIONS_MOVE_TABLE_LABEL),
					rowActionsAria: t(RestaurantsKeys.TABLES_ROW_ACTIONS),
				}}
			/>
		);
	};

	const filterVisible = (list: Doc<"tables">[]) => list.filter((tt) => showInactive || tt.isActive);

	return (
		<DndContext
			sensors={dnd.sensors}
			collisionDetection={closestCenter}
			onDragStart={dnd.handleDragStart}
			onDragEnd={dnd.handleDragEnd}
			onDragCancel={dnd.handleDragCancel}
		>
			<div className="space-y-6 pb-16">
				{error && <InlineError message={error} onDismiss={clearError} />}

				<div className="space-y-3">
					<NewSectionForm
						restaurantId={restaurantId}
						onCreateSection={async (input) => {
							clearError();
							try {
								unwrapResult(await createSection(input));
							} catch (err) {
								setMutationError(err, RestaurantsKeys.SECTIONS_CREATE_FAILED);
								throw err;
							}
						}}
					/>
					<NewTableForm
						restaurantId={restaurantId}
						nextTableNumber={nextTableNumber}
						sections={dnd.orderedSections}
						sectionLabel={sectionLabel}
						onCreate={async (input) => {
							clearError();
							try {
								unwrapResult(await createTable(input));
							} catch (err) {
								setMutationError(err, RestaurantsKeys.TABLES_CREATE_FAILED);
								throw err;
							}
						}}
					/>
					<TablesToolbar
						hasTables={tables.length > 0}
						selectionMode={selectionMode}
						selectedCount={selectedTableIds.size}
						onToggleSelectionMode={toggleSelectionMode}
						onBulkDelete={() => setConfirmBulkDelete(true)}
						onCancelSelection={() => toggleSelectionMode(false)}
					/>
				</div>

				<div className={dnd.gridClass}>
					<SortableContext items={dnd.sortableSectionIds} strategy={rectSortingStrategy}>
						{dnd.orderedSections.map((section, idx) => {
							const tablesInSection = dnd.tablesBySection.byId.get(section._id) ?? [];
							const filtered = filterVisible(tablesInSection);
							const fallbackLabel = sectionLabel(section, idx);
							return (
								<SectionCard
									key={section._id}
									section={section}
									isEditing={editingSectionId === section._id}
									initialRenameValue={
										section.name && section.name.length > 0 ? section.name : fallbackLabel
									}
									tables={filtered}
									isDraggingTable={dnd.isDraggingTable}
									sectionLabel={fallbackLabel}
									translations={{
										tableCount: t(RestaurantsKeys.SECTIONS_TABLE_COUNT_SHORT, {
											count: tablesInSection.length,
										}),
										dropHere: t(RestaurantsKeys.TABLES_DROP_HERE),
										renameTitle: t(RestaurantsKeys.SECTIONS_RENAME_TITLE),
										deleteTitle: t(RestaurantsKeys.SECTIONS_DELETE_TITLE),
										save: t(RestaurantsKeys.TABLES_SAVE),
										cancel: t(RestaurantsKeys.TABLES_CANCEL),
										dragHandle: t(RestaurantsKeys.SECTIONS_DRAG_HANDLE),
										renamePlaceholder: t(RestaurantsKeys.SECTIONS_RENAME_PLACEHOLDER),
										hideTitle: t(RestaurantsKeys.SECTIONS_HIDE_TITLE),
										showTitle: t(RestaurantsKeys.SECTIONS_SHOW_TITLE),
										hiddenBadge: t(RestaurantsKeys.SECTIONS_HIDDEN_BADGE),
									}}
									onStartRename={() => {
										clearError();
										setEditingSectionId(section._id);
									}}
									onCancelRename={cancelSectionEdit}
									onSubmitRename={(name) => handleSectionRename(section._id, name)}
									onRemove={() => {
										clearError();
										setConfirmDeleteSectionId(section._id);
									}}
									onToggleHidden={() => handleSectionHiddenToggle(section)}
									renderTableRow={renderTableRow}
								/>
							);
						})}
					</SortableContext>
				</div>

				<UnassignedTablesPanel
					tables={filterVisible(dnd.tablesBySection.unassigned)}
					renderTableRow={renderTableRow}
				/>

				{tables.length === 0 && (
					<p className="text-sm py-4 text-center text-faint-foreground">
						{t(RestaurantsKeys.TABLES_EMPTY)}
					</p>
				)}

				<TrashPanel
					show={showTrash}
					onToggle={() => setShowTrash((v) => !v)}
					deletedSections={deletedSections}
					deletedTables={deletedTables}
					onRestoreSection={handleRestoreSection}
					onRestoreTable={handleRestoreTable}
					sectionLabel={sectionLabel}
				/>

				<InactiveTablesBar
					inactiveCount={inactiveCount}
					showInactive={showInactive}
					onToggle={() => setShowInactive((v) => !v)}
				/>
			</div>

			<BulkDeleteConfirmModal
				isOpen={confirmBulkDelete}
				selectedCount={selectedTableIds.size}
				isPending={isBulkRemovePending}
				onClose={() => setConfirmBulkDelete(false)}
				onConfirm={() => void handleConfirmBulkDelete()}
			/>

			<SectionDeleteConfirmModal
				section={confirmDeleteSection}
				sectionDisplayName={confirmDeleteSectionDisplayName}
				confirmDeleteBody={confirmDeleteBody}
				onClose={() => setConfirmDeleteSectionId(null)}
				onConfirm={() => void handleConfirmDeleteSection()}
			/>

			<DragOverlay dropAnimation={null}>{dnd.dragOverlayContent}</DragOverlay>
		</DndContext>
	);
}
