import { InlineError, Modal, TextInput } from "@/global/components";
import { RestaurantsKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	closestCenter,
	DndContext,
	DragOverlay,
	type DragEndEvent,
	type DragStartEvent,
	KeyboardSensor,
	PointerSensor,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	rectSortingStrategy,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import {
	Check,
	Eye,
	EyeOff,
	GripVertical,
	MoreVertical,
	Pencil,
	Plus,
	RotateCcw,
	ToggleLeft,
	ToggleRight,
	Trash2,
	X,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactElement,
	type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

interface TablesManagerProps {
	restaurantId: Id<"restaurants">;
}

const DEFAULT_CAPACITY = 4;
const SECTION_DRAG_PREFIX = "section";
const TABLE_DRAG_PREFIX = "table";
const SECTION_DROP_PREFIX = "section-drop";

const COLS_GRID_CLASS: Record<1 | 2 | 3, string> = {
	1: "grid gap-4 grid-cols-1",
	2: "grid gap-4 grid-cols-1 md:grid-cols-2",
	3: "grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
};

// 1, 2, 3 sections → matching column count. 4 sections look better as 2×2,
// 5+ stays at 3 columns and wraps. Since the system Default is gone, every
// section participates in the count.
function gridColumnsForCount(count: number): 1 | 2 | 3 {
	if (count <= 1) return 1;
	if (count === 2) return 2;
	if (count === 4) return 2;
	return 3;
}

function formatRemaining(ms: number): string {
	if (ms <= 0) return "0m";
	const totalMinutes = Math.floor(ms / 60_000);
	if (totalMinutes < 60) return `${totalMinutes}m`;
	const hours = Math.floor(totalMinutes / 60);
	if (hours < 48) return `${hours}h`;
	const days = Math.floor(hours / 24);
	return `${days}d`;
}

export function TablesManager({ restaurantId }: Readonly<TablesManagerProps>) {
	const { t } = useTranslation();
	const { data: tables } = useQuery(convexQuery(api.tables.getByRestaurant, { restaurantId }));
	const { data: sections } = useQuery(convexQuery(api.sections.getByRestaurant, { restaurantId }));

	const [showTrash, setShowTrash] = useState(false);
	const { data: deletedTables = [] } = useQuery({
		...convexQuery(api.tables.getDeletedForRestaurant, { restaurantId }),
		enabled: showTrash,
	});
	const { data: deletedSections = [] } = useQuery({
		...convexQuery(api.sections.getDeletedForRestaurant, { restaurantId }),
		enabled: showTrash,
	});

	const createTable = useMutation({ mutationFn: useConvexMutation(api.tables.create) });
	const updateTable = useMutation({ mutationFn: useConvexMutation(api.tables.update) });
	const toggleActive = useMutation({ mutationFn: useConvexMutation(api.tables.toggleActive) });
	const removeTable = useMutation({ mutationFn: useConvexMutation(api.tables.remove) });
	const bulkRemoveTables = useMutation({ mutationFn: useConvexMutation(api.tables.bulkRemove) });
	const restoreTable = useMutation({ mutationFn: useConvexMutation(api.tables.restore) });

	const createSection = useMutation({ mutationFn: useConvexMutation(api.sections.create) });
	const updateSection = useMutation({ mutationFn: useConvexMutation(api.sections.update) });
	const removeSection = useMutation({ mutationFn: useConvexMutation(api.sections.remove) });
	const restoreSection = useMutation({ mutationFn: useConvexMutation(api.sections.restore) });
	const assignTableSection = useMutation({
		mutationFn: useConvexMutation(api.sections.assignTable),
	});

	const [editingId, setEditingId] = useState<Id<"tables"> | null>(null);
	const [editingSectionId, setEditingSectionId] = useState<Id<"sections"> | null>(null);
	const [confirmDeleteSectionId, setConfirmDeleteSectionId] = useState<Id<"sections"> | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [showInactive, setShowInactive] = useState(false);
	const [activeDragId, setActiveDragId] = useState<string | null>(null);
	const [openKebab, setOpenKebab] = useState<Id<"tables"> | null>(null);
	const [selectionMode, setSelectionMode] = useState(false);
	const [selectedTableIds, setSelectedTableIds] = useState(() => new Set<Id<"tables">>());
	const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

	// Optimistic overrides: cleared once server state catches up.
	const [tableSectionOverrides, setTableSectionOverrides] = useState<
		Map<Id<"tables">, Id<"sections">>
	>(() => new Map());
	const [sectionOrderOverride, setSectionOrderOverride] = useState<Id<"sections">[] | null>(null);

	const clearError = () => setError(null);
	const closeKebab = useCallback(() => setOpenKebab(null), []);

	const sectionsList = useMemo(() => sections ?? [], [sections]);

	// Reconcile optimistic overrides when the server data catches up.
	useEffect(() => {
		if (tableSectionOverrides.size === 0 || !tables) return;
		const tableById = new Map(tables.map((tt) => [tt._id, tt] as const));
		let changed = false;
		const next = new Map(tableSectionOverrides);
		for (const [tableId, sectionId] of tableSectionOverrides) {
			const cur = tableById.get(tableId);
			if (cur && cur.sectionId === sectionId) {
				next.delete(tableId);
				changed = true;
			}
		}
		if (changed) setTableSectionOverrides(next);
	}, [tables, tableSectionOverrides]);

	useEffect(() => {
		if (!sectionOrderOverride || !sections) return;
		const serverOrder = sections.map((s) => s._id).join("|");
		const localOrder = sectionOrderOverride.join("|");
		if (serverOrder === localOrder) setSectionOrderOverride(null);
	}, [sections, sectionOrderOverride]);

	const orderedSections = useMemo(() => {
		if (!sectionOrderOverride) return sectionsList;
		const byId = new Map(sectionsList.map((s) => [s._id, s] as const));
		const ordered: Doc<"sections">[] = [];
		for (const id of sectionOrderOverride) {
			const s = byId.get(id);
			if (s) ordered.push(s);
		}
		for (const s of sectionsList) {
			if (!sectionOrderOverride.includes(s._id)) ordered.push(s);
		}
		return ordered;
	}, [sectionsList, sectionOrderOverride]);

	const sectionLabel = useCallback(
		(section: Doc<"sections">, fallbackIndex: number): string => {
			if (section.name && section.name.length > 0) return section.name;
			return t(RestaurantsKeys.SECTIONS_UNNAMED, { number: fallbackIndex + 1 });
		},
		[t]
	);

	const newSectionForm = useForm({
		defaultValues: { name: "" },
		onSubmit: async ({ value }) => {
			clearError();
			try {
				unwrapResult(
					await createSection.mutateAsync({
						restaurantId,
						name: value.name || undefined,
					})
				);
				newSectionForm.reset();
			} catch (err) {
				setError(err instanceof Error ? err.message : t(RestaurantsKeys.SECTIONS_CREATE_FAILED));
			}
		},
	});

	const cancelEdit = () => {
		setEditingId(null);
	};

	const cancelSectionEdit = () => {
		setEditingSectionId(null);
	};

	const handleToggleActive = async (tableId: Id<"tables">) => {
		clearError();
		try {
			unwrapResult(await toggleActive.mutateAsync({ tableId }));
		} catch (err) {
			setError(err instanceof Error ? err.message : t(RestaurantsKeys.TABLES_TOGGLE_FAILED));
		}
	};

	const handleRemoveTable = async (tableId: Id<"tables">) => {
		clearError();
		try {
			unwrapResult(await removeTable.mutateAsync({ tableId }));
		} catch (err) {
			setError(err instanceof Error ? err.message : t(RestaurantsKeys.TABLES_REMOVE_FAILED));
		}
	};

	const toggleSelectionMode = (enabled: boolean) => {
		clearError();
		if (enabled && editingId !== null) {
			setEditingId(null);
		}
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

	const cancelSelection = () => {
		toggleSelectionMode(false);
	};

	const handleConfirmBulkDelete = async () => {
		const tableIds = [...selectedTableIds];
		if (tableIds.length === 0) return;
		clearError();
		setConfirmBulkDelete(false);
		try {
			unwrapResult(
				await bulkRemoveTables.mutateAsync({
					restaurantId,
					tableIds,
				})
			);
			toggleSelectionMode(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : t(RestaurantsKeys.TABLES_BULK_REMOVE_FAILED));
		}
	};

	const handleRestoreTable = async (tableId: Id<"tables">) => {
		clearError();
		try {
			unwrapResult(await restoreTable.mutateAsync({ tableId }));
		} catch (err) {
			setError(err instanceof Error ? err.message : t(RestaurantsKeys.TABLES_RESTORE_FAILED));
		}
	};

	const handleConfirmDeleteSection = async () => {
		if (!confirmDeleteSectionId) return;
		clearError();
		const sectionId = confirmDeleteSectionId;
		setConfirmDeleteSectionId(null);
		try {
			unwrapResult(await removeSection.mutateAsync({ sectionId }));
		} catch (err) {
			setError(err instanceof Error ? err.message : t(RestaurantsKeys.SECTIONS_REMOVE_FAILED));
		}
	};

	const handleRestoreSection = async (sectionId: Id<"sections">) => {
		clearError();
		try {
			unwrapResult(await restoreSection.mutateAsync({ sectionId }));
		} catch (err) {
			setError(err instanceof Error ? err.message : t(RestaurantsKeys.SECTIONS_RESTORE_FAILED));
		}
	};

	const handleSectionHiddenToggle = async (section: Doc<"sections">) => {
		clearError();
		try {
			unwrapResult(
				await updateSection.mutateAsync({
					sectionId: section._id,
					isActive: section.isActive === false,
				})
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : t(RestaurantsKeys.SECTIONS_UPDATE_FAILED));
		}
	};

	const handleSectionRename = async (sectionId: Id<"sections">, nextName: string) => {
		clearError();
		try {
			unwrapResult(
				await updateSection.mutateAsync({
					sectionId,
					name: nextName,
				})
			);
			setEditingSectionId(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : t(RestaurantsKeys.SECTIONS_UPDATE_FAILED));
		}
	};

	const handleTableEdit = async (
		tableId: Id<"tables">,
		next: { tableNumber: number; capacity: number | undefined }
	) => {
		clearError();
		try {
			unwrapResult(
				await updateTable.mutateAsync({
					tableId,
					tableNumber: next.tableNumber,
					capacity: next.capacity,
				})
			);
			cancelEdit();
		} catch (err) {
			setError(err instanceof Error ? err.message : t(RestaurantsKeys.TABLES_UPDATE_FAILED));
		}
	};

	const handleMoveTableToSection = async (tableId: Id<"tables">, nextSectionId: Id<"sections">) => {
		clearError();
		setTableSectionOverrides((prev) => {
			const next = new Map(prev);
			next.set(tableId, nextSectionId);
			return next;
		});
		try {
			unwrapResult(await assignTableSection.mutateAsync({ tableId, sectionId: nextSectionId }));
		} catch (err) {
			setTableSectionOverrides((prev) => {
				const next = new Map(prev);
				next.delete(tableId);
				return next;
			});
			setError(err instanceof Error ? err.message : t(RestaurantsKeys.SECTIONS_ASSIGN_FAILED));
		}
	};

	const reorderSections = async (orderedIds: Id<"sections">[]) => {
		clearError();
		setSectionOrderOverride(orderedIds);
		try {
			await Promise.all(
				orderedIds.map((sectionId, index) =>
					updateSection.mutateAsync({ sectionId, displayOrder: index }).then((r) => unwrapResult(r))
				)
			);
		} catch (err) {
			setSectionOrderOverride(null);
			setError(err instanceof Error ? err.message : t(RestaurantsKeys.SECTIONS_REORDER_FAILED));
		}
	};

	const effectiveSectionIdForTable = (table: Doc<"tables">): Id<"sections"> | undefined => {
		const override = tableSectionOverrides.get(table._id);
		return override ?? table.sectionId;
	};

	const tablesBySection = useMemo(() => {
		const byId = new Map<string, Doc<"tables">[]>();
		const unassigned: Doc<"tables">[] = [];
		for (const table of tables ?? []) {
			const sectionId = effectiveSectionIdForTable(table);
			if (sectionId) {
				const list = byId.get(sectionId) ?? [];
				list.push(table);
				byId.set(sectionId, list);
			} else {
				unassigned.push(table);
			}
		}
		for (const list of byId.values()) {
			list.sort((a, b) => a.tableNumber - b.tableNumber);
		}
		unassigned.sort((a, b) => a.tableNumber - b.tableNumber);
		return { byId, unassigned };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [tables, tableSectionOverrides]);

	const inactiveCount = useMemo(() => (tables ?? []).filter((tt) => !tt.isActive).length, [tables]);

	const visibleTableIds = useMemo(() => {
		const ids = new Set<Id<"tables">>();
		for (const table of tables ?? []) {
			if (showInactive || table.isActive) ids.add(table._id);
		}
		return ids;
	}, [tables, showInactive]);

	const tableIdsFingerprint = useMemo(
		() =>
			[...(tables ?? [])]
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

	const nextTableNumber = useMemo(
		() => (tables ?? []).reduce((max, tt) => Math.max(max, tt.tableNumber), 0) + 1,
		[tables]
	);

	const confirmDeleteSection = useMemo(
		() =>
			confirmDeleteSectionId
				? sectionsList.find((s) => s._id === confirmDeleteSectionId)
				: undefined,
		[confirmDeleteSectionId, sectionsList]
	);
	const confirmDeleteTablesCount = useMemo(
		() =>
			confirmDeleteSectionId ? (tablesBySection.byId.get(confirmDeleteSectionId) ?? []).length : 0,
		[confirmDeleteSectionId, tablesBySection]
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

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
	);

	const handleDragStart = (event: DragStartEvent) => {
		const activeId = String(event.active.id);
		if (selectionMode && activeId.startsWith(TABLE_DRAG_PREFIX + ":")) return;
		setActiveDragId(activeId);
		setOpenKebab(null);
	};

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		setActiveDragId(null);
		if (!over) return;
		const activeId = String(active.id);
		const overId = String(over.id);

		if (selectionMode && activeId.startsWith(TABLE_DRAG_PREFIX + ":")) return;

		if (activeId.startsWith(TABLE_DRAG_PREFIX + ":")) {
			const tableId = activeId.slice(TABLE_DRAG_PREFIX.length + 1) as Id<"tables">;
			let destSectionId: Id<"sections"> | null = null;
			if (overId.startsWith(SECTION_DROP_PREFIX + ":")) {
				destSectionId = overId.slice(SECTION_DROP_PREFIX.length + 1) as Id<"sections">;
			} else if (overId.startsWith(SECTION_DRAG_PREFIX + ":")) {
				destSectionId = overId.slice(SECTION_DRAG_PREFIX.length + 1) as Id<"sections">;
			}
			if (!destSectionId) return;
			const table = (tables ?? []).find((tt) => tt._id === tableId);
			if (!table) return;
			if (effectiveSectionIdForTable(table) === destSectionId) return;
			void handleMoveTableToSection(tableId, destSectionId);
			return;
		}

		if (activeId.startsWith(SECTION_DRAG_PREFIX + ":")) {
			const fromId = activeId.slice(SECTION_DRAG_PREFIX.length + 1) as Id<"sections">;
			let toId: Id<"sections"> | null = null;
			if (overId.startsWith(SECTION_DRAG_PREFIX + ":")) {
				toId = overId.slice(SECTION_DRAG_PREFIX.length + 1) as Id<"sections">;
			} else if (overId.startsWith(SECTION_DROP_PREFIX + ":")) {
				toId = overId.slice(SECTION_DROP_PREFIX.length + 1) as Id<"sections">;
			}
			if (!toId || fromId === toId) return;
			const currentOrder = orderedSections.map((s) => s._id);
			const fromIndex = currentOrder.indexOf(fromId);
			const toIndex = currentOrder.indexOf(toId);
			if (fromIndex < 0 || toIndex < 0) return;
			const reordered = [...currentOrder];
			reordered.splice(fromIndex, 1);
			reordered.splice(toIndex, 0, fromId);
			void reorderSections(reordered);
			return;
		}
	};

	const renderTableRow = (table: Doc<"tables">) => {
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
				onAssignSection={handleMoveTableToSection}
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

	const cols = gridColumnsForCount(orderedSections.length);
	const gridClass = COLS_GRID_CLASS[cols];

	const isDraggingTable = activeDragId?.startsWith(TABLE_DRAG_PREFIX + ":") ?? false;

	const dragOverlayContent = useMemo(() => {
		if (!activeDragId) return null;
		if (activeDragId.startsWith(TABLE_DRAG_PREFIX + ":")) {
			const tableId = activeDragId.slice(TABLE_DRAG_PREFIX.length + 1) as Id<"tables">;
			const table = (tables ?? []).find((tt) => tt._id === tableId);
			if (!table) return null;
			return <TableDragGhost table={table} t={t} />;
		}
		if (activeDragId.startsWith(SECTION_DRAG_PREFIX + ":")) {
			const sectionId = activeDragId.slice(SECTION_DRAG_PREFIX.length + 1) as Id<"sections">;
			const idx = orderedSections.findIndex((s) => s._id === sectionId);
			const section = idx >= 0 ? orderedSections[idx] : undefined;
			if (!section) return null;
			return (
				<SectionDragGhost
					label={sectionLabel(section, idx)}
					count={(tablesBySection.byId.get(section._id) ?? []).length}
					countText={t(RestaurantsKeys.SECTIONS_TABLE_COUNT_SHORT, {
						count: (tablesBySection.byId.get(section._id) ?? []).length,
					})}
				/>
			);
		}
		return null;
	}, [activeDragId, tables, orderedSections, tablesBySection, sectionLabel, t]);

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
			onDragCancel={() => setActiveDragId(null)}
		>
			<div className="space-y-6 pb-16">
				{error && <InlineError message={error} onDismiss={clearError} />}

				<div className="space-y-3">
					<div>
						<h3 className="text-sm font-semibold text-foreground">
							{t(RestaurantsKeys.SECTIONS_HEADING)}
						</h3>
						<p className="text-xs text-faint-foreground max-w-md">
							{t(RestaurantsKeys.SECTIONS_HINT)}
						</p>
					</div>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							e.stopPropagation();
							newSectionForm.handleSubmit();
						}}
						className="flex gap-2 items-end flex-wrap"
					>
						<newSectionForm.Field
							name="name"
							children={(field) => (
								<TextInput
									id="new-section-name"
									type="text"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									placeholder={t(RestaurantsKeys.SECTIONS_NEW_NAME_PLACEHOLDER)}
									className="w-64"
								/>
							)}
						/>
						<button
							type="submit"
							className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium hover-btn-primary"
						>
							<Plus size={16} />
							{t(RestaurantsKeys.SECTIONS_ADD)}
						</button>
					</form>
					<NewTableForm
						restaurantId={restaurantId}
						nextTableNumber={nextTableNumber}
						sections={orderedSections}
						sectionLabel={sectionLabel}
						onCreate={async (input) => {
							clearError();
							try {
								unwrapResult(await createTable.mutateAsync(input));
							} catch (err) {
								setError(
									err instanceof Error ? err.message : t(RestaurantsKeys.TABLES_CREATE_FAILED)
								);
								throw err;
							}
						}}
					/>
					{(tables ?? []).length > 0 ? (
						<div className="flex flex-wrap items-center gap-3">
							<label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
								<input
									type="checkbox"
									checked={selectionMode}
									onChange={(e) => toggleSelectionMode(e.target.checked)}
									className="h-4 w-4 rounded border-border accent-[var(--btn-primary-bg)]"
								/>
								{t(RestaurantsKeys.TABLES_SELECT_MODE)}
							</label>
							{selectionMode ? (
								<>
									<button
										type="button"
										disabled={selectedTableIds.size === 0}
										onClick={() => setConfirmBulkDelete(true)}
										className="px-3 py-1.5 rounded-md text-sm font-medium text-destructive border border-border hover:bg-hover disabled:opacity-50 disabled:pointer-events-none"
									>
										{t(RestaurantsKeys.TABLES_BULK_REMOVE, { count: selectedTableIds.size })}
									</button>
									<button
										type="button"
										onClick={cancelSelection}
										className="px-3 py-1.5 rounded-md text-sm font-medium border border-border hover:bg-hover"
									>
										{t(RestaurantsKeys.TABLES_BULK_CANCEL)}
									</button>
								</>
							) : null}
						</div>
					) : null}
				</div>

				<div className={gridClass}>
					<SortableContext
						items={orderedSections.map((s) => `${SECTION_DRAG_PREFIX}:${s._id}`)}
						strategy={rectSortingStrategy}
					>
						{orderedSections.map((section, idx) => {
							const tablesInSection = tablesBySection.byId.get(section._id) ?? [];
							const filtered = tablesInSection.filter((tt) => showInactive || tt.isActive);
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
									isDraggingTable={isDraggingTable}
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

				{tablesBySection.unassigned.length > 0 && (
					<div className="space-y-2">
						<h4 className="text-sm font-semibold text-foreground">
							{t(RestaurantsKeys.SECTIONS_UNNAMED, { number: 0 })}
						</h4>
						<div className="space-y-2">
							{tablesBySection.unassigned
								.filter((tt) => showInactive || tt.isActive)
								.map((table) => renderTableRow(table))}
						</div>
					</div>
				)}

				{(tables ?? []).length === 0 && (
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

				{inactiveCount > 0 && (
					<div className="sticky bottom-0 z-10 -mx-6 px-6 py-3 bg-background border-t border-border flex justify-end">
						<button
							type="button"
							onClick={() => setShowInactive((v) => !v)}
							className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-hover text-faint-foreground"
						>
							{showInactive
								? t(RestaurantsKeys.TABLES_HIDE_INACTIVE)
								: t(RestaurantsKeys.TABLES_SHOW_INACTIVE, { count: inactiveCount })}
						</button>
					</div>
				)}
			</div>

			<Modal
				isOpen={confirmBulkDelete}
				onClose={() => setConfirmBulkDelete(false)}
				ariaLabel={t(RestaurantsKeys.TABLES_BULK_CONFIRM_HEADING)}
				size="md"
			>
				<div className="p-6 rounded-xl bg-background border border-border">
					<div className="flex items-center justify-between mb-4">
						<h2 className="text-lg font-semibold text-foreground">
							{t(RestaurantsKeys.TABLES_BULK_CONFIRM_HEADING)}
						</h2>
						<button
							type="button"
							onClick={() => setConfirmBulkDelete(false)}
							className="p-1.5 rounded-md hover:bg-hover text-faint-foreground"
						>
							<X size={20} />
						</button>
					</div>
					<p className="text-sm text-foreground mb-6">
						{t(RestaurantsKeys.TABLES_BULK_CONFIRM_BODY, { count: selectedTableIds.size })}
					</p>
					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={() => setConfirmBulkDelete(false)}
							className="px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-hover"
						>
							{t(RestaurantsKeys.TABLES_CANCEL)}
						</button>
						<button
							type="button"
							onClick={() => void handleConfirmBulkDelete()}
							disabled={bulkRemoveTables.isPending}
							className="px-4 py-2 rounded-lg text-sm font-medium bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50"
						>
							{t(RestaurantsKeys.TABLES_BULK_CONFIRM_REMOVE)}
						</button>
					</div>
				</div>
			</Modal>

			<Modal
				isOpen={confirmDeleteSection !== undefined}
				onClose={() => setConfirmDeleteSectionId(null)}
				ariaLabel={t(RestaurantsKeys.SECTIONS_CONFIRM_DELETE_HEADING)}
				size="md"
			>
				{confirmDeleteSection && (
					<div className="p-6 rounded-xl bg-background border border-border">
						<div className="flex items-center justify-between mb-4">
							<h2 className="text-lg font-semibold text-foreground">
								{t(RestaurantsKeys.SECTIONS_CONFIRM_DELETE_HEADING)}
							</h2>
							<button
								type="button"
								onClick={() => setConfirmDeleteSectionId(null)}
								className="p-1.5 rounded-md hover:bg-hover text-faint-foreground"
							>
								<X size={20} />
							</button>
						</div>
						<p className="text-sm text-muted-foreground mb-2">
							{confirmDeleteSection.name ??
								t(RestaurantsKeys.SECTIONS_UNNAMED, {
									number: orderedSections.findIndex((s) => s._id === confirmDeleteSection._id) + 1,
								})}
						</p>
						<p className="text-sm text-foreground mb-6">{confirmDeleteBody}</p>
						<div className="flex justify-end gap-2">
							<button
								type="button"
								onClick={() => setConfirmDeleteSectionId(null)}
								className="px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-hover"
							>
								{t(RestaurantsKeys.SECTIONS_CONFIRM_DELETE_CANCEL)}
							</button>
							<button
								type="button"
								onClick={handleConfirmDeleteSection}
								className="px-4 py-2 rounded-lg text-sm font-medium bg-destructive text-destructive-foreground hover:opacity-90"
							>
								{t(RestaurantsKeys.SECTIONS_CONFIRM_DELETE_CONFIRM)}
							</button>
						</div>
					</div>
				)}
			</Modal>

			<DragOverlay dropAnimation={null}>{dragOverlayContent}</DragOverlay>
		</DndContext>
	);
}

interface NewTableFormProps {
	restaurantId: Id<"restaurants">;
	nextTableNumber: number;
	sections: readonly Doc<"sections">[];
	sectionLabel: (s: Doc<"sections">, idx: number) => string;
	onCreate: (input: {
		restaurantId: Id<"restaurants">;
		tableNumber: number;
		capacity: number;
		sectionId?: Id<"sections">;
	}) => Promise<void>;
}

/**
 * "Add table" form. The table number defaults to the next available integer
 * (max(tableNumber) + 1) and stays in sync as new tables are added, so a
 * single click on the Add button just works without any user typing.
 */
function NewTableForm({
	restaurantId,
	nextTableNumber,
	sections,
	sectionLabel,
	onCreate,
}: Readonly<NewTableFormProps>) {
	const { t } = useTranslation();
	const [tableNumberRaw, setTableNumberRaw] = useState<string>(String(nextTableNumber));
	const [capacityRaw, setCapacityRaw] = useState<string>("");
	const [sectionId, setSectionId] = useState<string>("");
	// Track whether the user has typed into the number field. While untouched,
	// keep it in sync with `nextTableNumber` so adding tables in a row stays
	// frictionless.
	const userTouchedNumberRef = useRef(false);

	useEffect(() => {
		if (!userTouchedNumberRef.current) {
			setTableNumberRaw(String(nextTableNumber));
		}
	}, [nextTableNumber]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const num = Number.parseInt(tableNumberRaw, 10);
		if (Number.isNaN(num) || num < 1) return;
		const cap = Number.parseInt(capacityRaw, 10);
		try {
			await onCreate({
				restaurantId,
				tableNumber: num,
				capacity: Number.isNaN(cap) ? DEFAULT_CAPACITY : cap,
				sectionId: sectionId.length > 0 ? (sectionId as Id<"sections">) : undefined,
			});
			setCapacityRaw("");
			setSectionId("");
			userTouchedNumberRef.current = false;
		} catch {
			// onCreate already surfaced the error in the parent.
		}
	};

	return (
		<form onSubmit={handleSubmit} className="flex gap-2 items-end flex-wrap">
			<TextInput
				type="number"
				label={t(RestaurantsKeys.TABLES_NUMBER_LABEL)}
				value={tableNumberRaw}
				onChange={(e) => {
					userTouchedNumberRef.current = true;
					setTableNumberRaw(e.target.value);
				}}
				min={1}
				className="w-24"
			/>
			<TextInput
				type="number"
				label={t(RestaurantsKeys.TABLES_SEATS_LABEL)}
				value={capacityRaw}
				onChange={(e) => setCapacityRaw(e.target.value)}
				min={1}
				placeholder={String(DEFAULT_CAPACITY)}
				className="w-24"
			/>
			<div>
				<label
					htmlFor="new-table-section"
					className="block text-xs font-medium mb-1 text-muted-foreground"
				>
					{t(RestaurantsKeys.TABLES_SECTION_LABEL)}
				</label>
				<select
					id="new-table-section"
					value={sectionId}
					onChange={(e) => setSectionId(e.target.value)}
					className="px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
				>
					{sections.length === 0 ? (
						<option value="">{t(RestaurantsKeys.SECTIONS_AUTO_CREATE_PLACEHOLDER)}</option>
					) : (
						sections.map((s, idx) => (
							<option key={s._id} value={s._id}>
								{sectionLabel(s, idx)}
							</option>
						))
					)}
				</select>
			</div>
			<button
				type="submit"
				className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium hover-btn-primary"
			>
				<Plus size={16} />
				{t(RestaurantsKeys.TABLES_ADD)}
			</button>
		</form>
	);
}

interface TableEditRowProps {
	table: Doc<"tables">;
	onSubmit: (next: { tableNumber: number; capacity: number | undefined }) => void;
	onCancel: () => void;
	labels: {
		numberLabel: string;
		seatsLabel: string;
		save: string;
		cancel: string;
	};
}

/**
 * Inline editor for a single table row. Mounted only while editing this
 * table; the parent uses the table id as the key so each invocation starts
 * from fresh local state pre-filled with the row's current values.
 */
function TableEditRow({ table, onSubmit, onCancel, labels }: Readonly<TableEditRowProps>) {
	const [numberRaw, setNumberRaw] = useState<string>(String(table.tableNumber));
	const [capacityRaw, setCapacityRaw] = useState<string>(
		table.capacity !== undefined ? String(table.capacity) : ""
	);

	const submit = () => {
		const num = Number.parseInt(numberRaw, 10);
		if (Number.isNaN(num)) return;
		const cap = Number.parseInt(capacityRaw, 10);
		onSubmit({
			tableNumber: num,
			capacity: Number.isNaN(cap) ? undefined : cap,
		});
	};

	return (
		<div className="flex items-center justify-between px-4 py-3 rounded-lg bg-muted border border-border">
			<div className="flex flex-wrap items-center gap-2 flex-1 mr-3">
				<TextInput
					type="number"
					value={numberRaw}
					onChange={(e) => setNumberRaw(e.target.value)}
					min={1}
					className="w-20"
					aria-label={labels.numberLabel}
				/>
				<TextInput
					type="number"
					value={capacityRaw}
					onChange={(e) => setCapacityRaw(e.target.value)}
					placeholder={labels.seatsLabel}
					min={1}
					className="w-20"
					aria-label={labels.seatsLabel}
				/>
				<button
					onClick={submit}
					className="p-1.5 rounded-md hover:bg-hover text-success"
					title={labels.save}
				>
					<Check size={16} />
				</button>
				<button
					onClick={onCancel}
					className="p-1.5 rounded-md hover:bg-hover text-faint-foreground"
					title={labels.cancel}
				>
					<X size={16} />
				</button>
			</div>
		</div>
	);
}

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

function SectionCard(props: Readonly<SectionCardProps>) {
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

interface SectionRenameInlineProps {
	initialValue: string;
	placeholder: string;
	saveLabel: string;
	cancelLabel: string;
	onSubmit: (name: string) => void;
	onCancel: () => void;
}

/**
 * Inline section rename input. Owns its own local state, mounted only while
 * editing (parent passes a key tied to the section id), so each session starts
 * pre-filled with the section's displayed label.
 */
function SectionRenameInline({
	initialValue,
	placeholder,
	saveLabel,
	cancelLabel,
	onSubmit,
	onCancel,
}: Readonly<SectionRenameInlineProps>) {
	const [value, setValue] = useState(initialValue);
	return (
		<div className="flex items-center gap-2 flex-1 min-w-0">
			<TextInput
				type="text"
				value={value}
				onChange={(e) => setValue(e.target.value)}
				placeholder={placeholder}
				className="w-full"
				autoFocus
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						onSubmit(value);
					} else if (e.key === "Escape") {
						e.preventDefault();
						onCancel();
					}
				}}
			/>
			<button
				onClick={() => onSubmit(value)}
				className="p-1.5 rounded-md hover:bg-hover text-success shrink-0"
				title={saveLabel}
				type="button"
			>
				<Check size={16} />
			</button>
			<button
				onClick={onCancel}
				className="p-1.5 rounded-md hover:bg-hover text-faint-foreground shrink-0"
				title={cancelLabel}
				type="button"
			>
				<X size={16} />
			</button>
		</div>
	);
}

interface TrashPanelProps {
	show: boolean;
	onToggle: () => void;
	deletedSections: Doc<"sections">[];
	deletedTables: Doc<"tables">[];
	onRestoreSection: (id: Id<"sections">) => void;
	onRestoreTable: (id: Id<"tables">) => void;
	sectionLabel: (s: Doc<"sections">, idx: number) => string;
}

function TrashPanel({
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

function DraggableTableRow(props: Readonly<DraggableTableRowProps>) {
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

interface TableActionsKebabProps {
	isOpen: boolean;
	onOpen: () => void;
	onClose: () => void;
	ariaLabel: string;
	items: ReactNode;
}

function TableActionsKebab(props: Readonly<TableActionsKebabProps>) {
	const { isOpen, onOpen, onClose, ariaLabel, items } = props;
	const wrapperRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!isOpen) return;
		const onDown = (e: MouseEvent) => {
			if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
				onClose();
			}
		};
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [isOpen, onClose]);

	return (
		<div ref={wrapperRef} className="relative">
			<button
				type="button"
				onClick={() => (isOpen ? onClose() : onOpen())}
				className="p-1.5 rounded-md hover:bg-hover text-muted-foreground"
				title={ariaLabel}
				aria-label={ariaLabel}
				aria-haspopup="menu"
				aria-expanded={isOpen}
			>
				<MoreVertical size={16} />
			</button>
			{isOpen && (
				<div
					role="menu"
					className="absolute right-0 top-full mt-1 z-30 min-w-40 rounded-md border border-border bg-background shadow-md p-1 flex flex-col gap-0.5"
				>
					{items}
				</div>
			)}
		</div>
	);
}

interface TableDragGhostProps {
	table: Doc<"tables">;
	t: ReturnType<typeof useTranslation>["t"];
}

function TableDragGhost({ table, t }: Readonly<TableDragGhostProps>) {
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
	count: number;
	countText: string;
}

function SectionDragGhost({ label, countText }: Readonly<SectionDragGhostProps>) {
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
