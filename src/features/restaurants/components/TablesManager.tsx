import { InlineError, TextInput } from "@/global/components";
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
	GripVertical,
	MoreVertical,
	Pencil,
	Plus,
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

export function TablesManager({ restaurantId }: Readonly<TablesManagerProps>) {
	const { t } = useTranslation();
	const { data: tables } = useQuery(
		convexQuery(api.tables.getByRestaurant, { restaurantId })
	);
	const { data: sections } = useQuery(
		convexQuery(api.sections.getByRestaurant, { restaurantId })
	);

	const createTable = useMutation({ mutationFn: useConvexMutation(api.tables.create) });
	const updateTable = useMutation({ mutationFn: useConvexMutation(api.tables.update) });
	const toggleActive = useMutation({ mutationFn: useConvexMutation(api.tables.toggleActive) });
	const removeTable = useMutation({ mutationFn: useConvexMutation(api.tables.remove) });

	const createSection = useMutation({ mutationFn: useConvexMutation(api.sections.create) });
	const updateSection = useMutation({ mutationFn: useConvexMutation(api.sections.update) });
	const removeSection = useMutation({ mutationFn: useConvexMutation(api.sections.remove) });
	const assignTableSection = useMutation({
		mutationFn: useConvexMutation(api.sections.assignTable),
	});

	const [editingId, setEditingId] = useState<Id<"tables"> | null>(null);
	const [editingSectionId, setEditingSectionId] = useState<Id<"sections"> | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [showInactive, setShowInactive] = useState(false);
	const [activeDragId, setActiveDragId] = useState<string | null>(null);
	const [openKebab, setOpenKebab] = useState<Id<"tables"> | null>(null);

	// Optimistic overrides: cleared once server state catches up.
	const [tableSectionOverrides, setTableSectionOverrides] = useState<
		Map<Id<"tables">, Id<"sections">>
	>(() => new Map());
	const [sectionOrderOverride, setSectionOrderOverride] = useState<
		Id<"sections">[] | null
	>(null);

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
		// Append any sections not yet in the override (e.g. just-created).
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

	const editForm = useForm({
		defaultValues: { editNumber: "", editLabel: "", editCapacity: "" },
		onSubmit: async ({ value }) => {
			if (!editingId) return;
			clearError();
			const num = Number.parseInt(value.editNumber, 10);
			if (Number.isNaN(num)) return;
			const cap = Number.parseInt(value.editCapacity, 10);
			try {
				unwrapResult(
					await updateTable.mutateAsync({
						tableId: editingId,
						tableNumber: num,
						label: value.editLabel || undefined,
						capacity: Number.isNaN(cap) ? undefined : cap,
					})
				);
				cancelEdit();
			} catch (err) {
				setError(err instanceof Error ? err.message : t(RestaurantsKeys.TABLES_UPDATE_FAILED));
			}
		},
	});

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

	const renameSectionForm = useForm({
		defaultValues: { name: "" },
		onSubmit: async ({ value }) => {
			if (!editingSectionId) return;
			clearError();
			try {
				unwrapResult(
					await updateSection.mutateAsync({
						sectionId: editingSectionId,
						name: value.name,
					})
				);
				setEditingSectionId(null);
				renameSectionForm.reset();
			} catch (err) {
				setError(err instanceof Error ? err.message : t(RestaurantsKeys.SECTIONS_UPDATE_FAILED));
			}
		},
	});

	const newTableForm = useForm({
		defaultValues: {
			tableNumber: "",
			label: "",
			capacity: "",
			sectionId: "",
		},
		onSubmit: async ({ value }) => {
			clearError();
			const num = Number.parseInt(value.tableNumber, 10);
			if (Number.isNaN(num) || num < 1) return;
			const cap = Number.parseInt(value.capacity, 10);
			const sectionId =
				value.sectionId.length > 0
					? (value.sectionId as Id<"sections">)
					: undefined;
			try {
				unwrapResult(
					await createTable.mutateAsync({
						restaurantId,
						tableNumber: num,
						label: value.label || undefined,
						capacity: Number.isNaN(cap) ? DEFAULT_CAPACITY : cap,
						sectionId,
					})
				);
				newTableForm.reset();
			} catch (err) {
				setError(err instanceof Error ? err.message : t(RestaurantsKeys.TABLES_CREATE_FAILED));
			}
		},
	});

	const startEdit = (
		tableId: Id<"tables">,
		tableNumber: number,
		label?: string,
		capacity?: number
	) => {
		clearError();
		setEditingId(tableId);
		setOpenKebab(null);
		editForm.reset({
			editNumber: String(tableNumber),
			editLabel: label ?? "",
			editCapacity: capacity !== undefined ? String(capacity) : "",
		});
		editForm.setFieldValue("editNumber", String(tableNumber));
		editForm.setFieldValue("editLabel", label ?? "");
		editForm.setFieldValue("editCapacity", capacity !== undefined ? String(capacity) : "");
	};

	const cancelEdit = () => {
		setEditingId(null);
		editForm.reset();
	};

	const startSectionEdit = (section: Doc<"sections">) => {
		clearError();
		setEditingSectionId(section._id);
		renameSectionForm.reset({ name: section.name ?? "" });
		renameSectionForm.setFieldValue("name", section.name ?? "");
	};

	const cancelSectionEdit = () => {
		setEditingSectionId(null);
		renameSectionForm.reset();
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

	const handleRemoveSection = async (sectionId: Id<"sections">) => {
		clearError();
		try {
			unwrapResult(await removeSection.mutateAsync({ sectionId }));
		} catch (err) {
			setError(err instanceof Error ? err.message : t(RestaurantsKeys.SECTIONS_REMOVE_FAILED));
		}
	};

	const handleMoveTableToSection = async (
		tableId: Id<"tables">,
		nextSectionId: Id<"sections">
	) => {
		clearError();
		setTableSectionOverrides((prev) => {
			const next = new Map(prev);
			next.set(tableId, nextSectionId);
			return next;
		});
		try {
			unwrapResult(
				await assignTableSection.mutateAsync({ tableId, sectionId: nextSectionId })
			);
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
					updateSection.mutateAsync({ sectionId, displayOrder: index }).then((r) =>
						unwrapResult(r)
					)
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

	const inactiveCount = useMemo(
		() => (tables ?? []).filter((tt) => !tt.isActive).length,
		[tables]
	);

	const nextTableNumber = useMemo(
		() => (tables ?? []).reduce((max, tt) => Math.max(max, tt.tableNumber), 0) + 1,
		[tables]
	);

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
	);

	const handleDragStart = (event: DragStartEvent) => {
		setActiveDragId(String(event.active.id));
		setOpenKebab(null);
	};

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		setActiveDragId(null);
		if (!over) return;
		const activeId = String(active.id);
		const overId = String(over.id);

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

	const renderTableEditableRow = (table: Doc<"tables">) => (
		<div
			className="flex flex-wrap items-center gap-2 flex-1 mr-3"
			key={`${table._id}-edit`}
		>
			<editForm.Field
				name="editNumber"
				children={(field) => (
					<TextInput
						type="number"
						value={field.state.value}
						onChange={(e) => field.handleChange(e.target.value)}
						onBlur={field.handleBlur}
						min={1}
						className="w-20"
					/>
				)}
			/>
			<editForm.Field
				name="editLabel"
				children={(field) => (
					<TextInput
						type="text"
						value={field.state.value}
						onChange={(e) => field.handleChange(e.target.value)}
						onBlur={field.handleBlur}
						placeholder={t(RestaurantsKeys.TABLES_LABEL_LABEL)}
						className="w-32"
					/>
				)}
			/>
			<editForm.Field
				name="editCapacity"
				children={(field) => (
					<TextInput
						type="number"
						value={field.state.value}
						onChange={(e) => field.handleChange(e.target.value)}
						onBlur={field.handleBlur}
						placeholder={t(RestaurantsKeys.TABLES_SEATS_LABEL)}
						min={1}
						className="w-20"
					/>
				)}
			/>
			<button
				onClick={() => editForm.handleSubmit()}
				className="p-1.5 rounded-md hover:bg-hover text-success"
				title={t(RestaurantsKeys.TABLES_SAVE)}
			>
				<Check size={16} />
			</button>
			<button
				onClick={cancelEdit}
				className="p-1.5 rounded-md hover:bg-hover text-faint-foreground"
				title={t(RestaurantsKeys.TABLES_CANCEL)}
			>
				<X size={16} />
			</button>
		</div>
	);

	const renderTableRow = (table: Doc<"tables">) => {
		if (editingId === table._id) {
			return (
				<div
					key={table._id}
					className="flex items-center justify-between px-4 py-3 rounded-lg bg-muted border border-border"
				>
					{renderTableEditableRow(table)}
				</div>
			);
		}
		return (
			<DraggableTableRow
				key={table._id}
				table={table}
				dragHandleLabel={t(RestaurantsKeys.TABLES_DRAG_HANDLE)}
				sectionsList={sectionsList}
				sectionLabel={sectionLabel}
				onAssignSection={handleMoveTableToSection}
				onStartEdit={() => startEdit(table._id, table.tableNumber, table.label, table.capacity)}
				onToggleActive={() => handleToggleActive(table._id)}
				onRemove={() => handleRemoveTable(table._id)}
				isKebabOpen={openKebab === table._id}
				onOpenKebab={() => setOpenKebab(table._id)}
				onCloseKebab={closeKebab}
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

	const renameInput = (
		<renameSectionForm.Field
			name="name"
			children={(field) => (
				<TextInput
					type="text"
					value={field.state.value}
					onChange={(e) => field.handleChange(e.target.value)}
					onBlur={field.handleBlur}
					placeholder={t(RestaurantsKeys.SECTIONS_RENAME_PLACEHOLDER)}
					className="w-full"
				/>
			)}
		/>
	);

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
					<form
						onSubmit={(e) => {
							e.preventDefault();
							e.stopPropagation();
							newTableForm.handleSubmit();
						}}
						className="flex gap-2 items-end flex-wrap"
					>
						<newTableForm.Field
							name="tableNumber"
							children={(field) => (
								<TextInput
									type="number"
									label={t(RestaurantsKeys.TABLES_NUMBER_LABEL)}
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									min={1}
									required
									placeholder={String(nextTableNumber)}
									className="w-24"
								/>
							)}
						/>
						<newTableForm.Field
							name="label"
							children={(field) => (
								<TextInput
									type="text"
									label={t(RestaurantsKeys.TABLES_LABEL_LABEL)}
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									placeholder={t(RestaurantsKeys.TABLES_LABEL_PLACEHOLDER)}
									className="w-40"
								/>
							)}
						/>
						<newTableForm.Field
							name="capacity"
							children={(field) => (
								<TextInput
									type="number"
									label={t(RestaurantsKeys.TABLES_SEATS_LABEL)}
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									min={1}
									placeholder={String(DEFAULT_CAPACITY)}
									className="w-24"
								/>
							)}
						/>
						<newTableForm.Field
							name="sectionId"
							children={(field) => (
								<div>
									<label
										htmlFor="new-table-section"
										className="block text-xs font-medium mb-1 text-muted-foreground"
									>
										{t(RestaurantsKeys.TABLES_SECTION_LABEL)}
									</label>
									<select
										id="new-table-section"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										className="px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
									>
										{orderedSections.length === 0 ? (
											<option value="">
												{t(RestaurantsKeys.SECTIONS_AUTO_CREATE_PLACEHOLDER)}
											</option>
										) : (
											orderedSections.map((s, idx) => (
												<option key={s._id} value={s._id}>
													{sectionLabel(s, idx)}
												</option>
											))
										)}
									</select>
								</div>
							)}
						/>
						<button
							type="submit"
							className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium hover-btn-primary"
						>
							<Plus size={16} />
							{t(RestaurantsKeys.TABLES_ADD)}
						</button>
					</form>
				</div>

				<div className={gridClass}>
					<SortableContext
						items={orderedSections.map((s) => `${SECTION_DRAG_PREFIX}:${s._id}`)}
						strategy={rectSortingStrategy}
					>
						{orderedSections.map((section, idx) => {
							const tablesInSection = tablesBySection.byId.get(section._id) ?? [];
							const filtered = tablesInSection.filter((tt) => showInactive || tt.isActive);
							return (
								<SectionCard
									key={section._id}
									section={section}
									isEditing={editingSectionId === section._id}
									renameInput={renameInput}
									tables={filtered}
									isDraggingTable={isDraggingTable}
									sectionLabel={sectionLabel(section, idx)}
									translations={{
										tableCount: t(RestaurantsKeys.SECTIONS_TABLE_COUNT_SHORT, {
											count: tablesInSection.length,
										}),
										dropHere: t(RestaurantsKeys.TABLES_DROP_HERE),
										renameTitle: t(RestaurantsKeys.SECTIONS_RENAME_TITLE),
										deleteTitle:
											tablesInSection.length > 0
												? t(RestaurantsKeys.SECTIONS_NON_EMPTY_DELETE_TOOLTIP)
												: t(RestaurantsKeys.SECTIONS_DELETE_TITLE),
										save: t(RestaurantsKeys.TABLES_SAVE),
										cancel: t(RestaurantsKeys.TABLES_CANCEL),
										dragHandle: t(RestaurantsKeys.SECTIONS_DRAG_HANDLE),
									}}
									onStartRename={() => startSectionEdit(section)}
									onCancelRename={cancelSectionEdit}
									onSubmitRename={() => renameSectionForm.handleSubmit()}
									onRemove={() => handleRemoveSection(section._id)}
									renderTableRow={renderTableRow}
									deleteDisabled={tablesInSection.length > 0}
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
			<DragOverlay dropAnimation={null}>{dragOverlayContent}</DragOverlay>
		</DndContext>
	);
}

interface SectionCardProps {
	section: Doc<"sections">;
	isEditing: boolean;
	renameInput: ReactNode;
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
	};
	onStartRename: () => void;
	onCancelRename: () => void;
	onSubmitRename: () => void;
	onRemove: () => void;
	renderTableRow: (table: Doc<"tables">) => ReactElement;
	deleteDisabled: boolean;
}

function SectionCard(props: Readonly<SectionCardProps>) {
	const {
		section,
		isEditing,
		renameInput,
		tables,
		isDraggingTable,
		sectionLabel,
		translations,
		onStartRename,
		onCancelRename,
		onSubmitRename,
		onRemove,
		renderTableRow,
		deleteDisabled,
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

	return (
		<div
			ref={sortable.setNodeRef}
			style={style}
			className={`rounded-xl ${outlineClass} bg-background/50 p-3 space-y-3`}
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
					<div className="flex items-center gap-2 flex-1 min-w-0">
						{renameInput}
						<button
							onClick={onSubmitRename}
							className="p-1.5 rounded-md hover:bg-hover text-success shrink-0"
							title={translations.save}
						>
							<Check size={16} />
						</button>
						<button
							onClick={onCancelRename}
							className="p-1.5 rounded-md hover:bg-hover text-faint-foreground shrink-0"
							title={translations.cancel}
						>
							<X size={16} />
						</button>
					</div>
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
								onClick={onStartRename}
								className="p-1.5 rounded-md hover:bg-hover text-muted-foreground"
								title={translations.renameTitle}
							>
								<Pencil size={14} />
							</button>
							<button
								onClick={onRemove}
								className="p-1.5 rounded-md hover:bg-hover text-destructive disabled:opacity-30 disabled:cursor-not-allowed"
								title={translations.deleteTitle}
								disabled={deleteDisabled}
							>
								<Trash2 size={14} />
							</button>
						</div>
					</>
				)}
			</div>

			<div
				ref={dropTarget.setNodeRef}
				className="space-y-2 min-h-12"
				aria-label={section.name ?? sectionLabel}
			>
				{tables.length === 0 ? (
					<div
						className={`px-4 py-6 rounded-lg text-center text-xs border border-dashed ${
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
		labels,
	} = props;
	const draggable = useDraggable({ id: `${TABLE_DRAG_PREFIX}:${table._id}` });
	// Hide the source row while dragging — the DragOverlay clone takes over.
	const style = {
		opacity: draggable.isDragging ? 0 : 1,
	};
	const inactive = !table.isActive;
	const rowClass = `flex items-center justify-between px-4 py-3 rounded-lg bg-muted border border-border ${
		inactive ? "opacity-60" : ""
	}`;

	return (
		<div ref={draggable.setNodeRef} style={style} className={rowClass}>
			<div className="flex items-center gap-3 min-w-0">
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
				<span
					className={`text-sm font-medium text-foreground ${inactive ? "line-through" : ""}`}
				>
					{labels.table}
				</span>
				{table.label && (
					<span className="text-xs text-faint-foreground truncate">{table.label}</span>
				)}
				<span className="text-xs text-faint-foreground">{labels.seatsFormat}</span>
			</div>
			<div className="flex items-center gap-2">
				<select
					value={table.sectionId ?? ""}
					onChange={(e) =>
						onAssignSection(table._id, e.target.value as Id<"sections">)
					}
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
			{table.label && (
				<span className="text-xs text-faint-foreground truncate">{table.label}</span>
			)}
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
