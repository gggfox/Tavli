import { InlineError, TextInput } from "@/global/components";
import { RestaurantsKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	closestCenter,
	DndContext,
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
	Pencil,
	Plus,
	ToggleLeft,
	ToggleRight,
	Trash2,
	X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
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

	// Optimistic overrides: cleared once server state catches up.
	const [tableSectionOverrides, setTableSectionOverrides] = useState<
		Map<Id<"tables">, Id<"sections">>
	>(() => new Map());
	const [sectionOrderOverride, setSectionOrderOverride] = useState<
		Id<"sections">[] | null
	>(null);

	const clearError = () => setError(null);

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

	const defaultSection = useMemo(
		() => orderedSections.find((s) => s.isSystem === true),
		[orderedSections]
	);
	const nonDefaultSections = useMemo(
		() => orderedSections.filter((s) => s.isSystem !== true),
		[orderedSections]
	);

	const sectionLabel = (section: Doc<"sections">, fallbackIndex: number): string => {
		if (
			section.isSystem === true &&
			(section.name === undefined || section.name === "Default")
		) {
			return t(RestaurantsKeys.SECTIONS_DEFAULT_BADGE);
		}
		if (section.name && section.name.length > 0) return section.name;
		return t(RestaurantsKeys.SECTIONS_UNNAMED, { number: fallbackIndex + 1 });
	};

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

	const startEdit = (
		tableId: Id<"tables">,
		tableNumber: number,
		label?: string,
		capacity?: number
	) => {
		clearError();
		setEditingId(tableId);
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

	const handleAddTableToSection = async (sectionId: Id<"sections">) => {
		clearError();
		const nextNumber =
			(tables ?? []).reduce((max, tt) => Math.max(max, tt.tableNumber), 0) + 1;
		try {
			const newId = unwrapResult(
				await createTable.mutateAsync({
					restaurantId,
					tableNumber: nextNumber,
					capacity: DEFAULT_CAPACITY,
					sectionId,
				})
			) as Id<"tables">;
			startEdit(newId, nextNumber, undefined, DEFAULT_CAPACITY);
		} catch (err) {
			setError(err instanceof Error ? err.message : t(RestaurantsKeys.TABLES_CREATE_FAILED));
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

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
	);

	const handleDragStart = (event: DragStartEvent) => {
		setActiveDragId(String(event.active.id));
	};

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		setActiveDragId(null);
		if (!over) return;
		const activeId = String(active.id);
		const overId = String(over.id);

		if (activeId.startsWith(TABLE_DRAG_PREFIX + ":")) {
			const tableId = activeId.slice(TABLE_DRAG_PREFIX.length + 1) as Id<"tables">;
			// over is either a section card (section: prefix) or a section drop area
			// (section-drop: prefix). Both encode the destination section ID.
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
			const currentOrder = nonDefaultSections.map((s) => s._id);
			const fromIndex = currentOrder.indexOf(fromId);
			const toIndex = currentOrder.indexOf(toId);
			// Dropping a section onto the default's drop area shouldn't reorder.
			if (fromIndex < 0 || toIndex < 0) return;
			const reordered = [...currentOrder];
			reordered.splice(fromIndex, 1);
			reordered.splice(toIndex, 0, fromId);
			// Pin the default section at the front so the persisted displayOrder
			// keeps it first.
			const fullOrder: Id<"sections">[] = defaultSection
				? [defaultSection._id, ...reordered]
				: reordered;
			void reorderSections(fullOrder);
			return;
		}
	};

	const renderTableEditableRow = (table: Doc<"tables">) => (
		<div className="flex items-center gap-3 flex-1 mr-3" key={`${table._id}-edit`}>
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
				}}
			/>
		);
	};

	const cols = gridColumnsForCount(nonDefaultSections.length);
	const gridClass = COLS_GRID_CLASS[cols];

	const isDraggingTable = activeDragId?.startsWith(TABLE_DRAG_PREFIX + ":") ?? false;

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
						className="flex gap-2 items-end"
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
				</div>

				<div className={gridClass}>
					<SortableContext
						items={nonDefaultSections.map((s) => `${SECTION_DRAG_PREFIX}:${s._id}`)}
						strategy={rectSortingStrategy}
					>
						{defaultSection && (
							<SectionCard
								key={defaultSection._id}
								section={defaultSection}
								sectionIndex={0}
								isSortable={false}
								isEditing={editingSectionId === defaultSection._id}
								renameInput={renameInput}
								tables={(tablesBySection.byId.get(defaultSection._id) ?? []).filter(
									(tt) => showInactive || tt.isActive
								)}
								isDraggingTable={isDraggingTable}
								sectionLabel={sectionLabel(defaultSection, 0)}
								translations={{
									defaultBadge: t(RestaurantsKeys.SECTIONS_DEFAULT_BADGE),
									tableCount: t(RestaurantsKeys.SECTIONS_TABLE_COUNT, {
										count: (tablesBySection.byId.get(defaultSection._id) ?? []).length,
									}),
									addTable: t(RestaurantsKeys.TABLES_ADD_IN_SECTION),
									dropHere: t(RestaurantsKeys.TABLES_DROP_HERE),
									renameTitle: t(RestaurantsKeys.SECTIONS_RENAME_TITLE),
									deleteTitle: t(RestaurantsKeys.SECTIONS_DEFAULT_DELETE_TOOLTIP),
									save: t(RestaurantsKeys.TABLES_SAVE),
									cancel: t(RestaurantsKeys.TABLES_CANCEL),
									dragHandle: t(RestaurantsKeys.SECTIONS_DRAG_HANDLE),
								}}
								onStartRename={() => startSectionEdit(defaultSection)}
								onCancelRename={cancelSectionEdit}
								onSubmitRename={() => renameSectionForm.handleSubmit()}
								onAddTable={() => handleAddTableToSection(defaultSection._id)}
								onRemove={() => handleRemoveSection(defaultSection._id)}
								renderTableRow={renderTableRow}
								deleteDisabled
							/>
						)}
						{nonDefaultSections.map((section, idx) => {
							const tablesInSection = tablesBySection.byId.get(section._id) ?? [];
							const filtered = tablesInSection.filter((tt) => showInactive || tt.isActive);
							return (
								<SectionCard
									key={section._id}
									section={section}
									sectionIndex={defaultSection ? idx + 1 : idx}
									isSortable
									isEditing={editingSectionId === section._id}
									renameInput={renameInput}
									tables={filtered}
									isDraggingTable={isDraggingTable}
									sectionLabel={sectionLabel(section, idx + (defaultSection ? 1 : 0))}
									translations={{
										defaultBadge: t(RestaurantsKeys.SECTIONS_DEFAULT_BADGE),
										tableCount: t(RestaurantsKeys.SECTIONS_TABLE_COUNT, {
											count: tablesInSection.length,
										}),
										addTable: t(RestaurantsKeys.TABLES_ADD_IN_SECTION),
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
									onAddTable={() => handleAddTableToSection(section._id)}
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
							{t(RestaurantsKeys.SECTIONS_DEFAULT_BADGE)}
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
		</DndContext>
	);
}

interface SectionCardProps {
	section: Doc<"sections">;
	sectionIndex: number;
	isSortable: boolean;
	isEditing: boolean;
	renameInput: ReactNode;
	tables: Doc<"tables">[];
	isDraggingTable: boolean;
	sectionLabel: string;
	translations: {
		defaultBadge: string;
		tableCount: string;
		addTable: string;
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
	onAddTable: () => void;
	onRemove: () => void;
	renderTableRow: (table: Doc<"tables">) => ReactElement;
	deleteDisabled: boolean;
}

function SectionCard(props: Readonly<SectionCardProps>) {
	const {
		section,
		isSortable,
		isEditing,
		renameInput,
		tables,
		isDraggingTable,
		sectionLabel,
		translations,
		onStartRename,
		onCancelRename,
		onSubmitRename,
		onAddTable,
		onRemove,
		renderTableRow,
		deleteDisabled,
	} = props;

	const sortableId = `${SECTION_DRAG_PREFIX}:${section._id}`;
	const sortable = useSortable({
		id: sortableId,
		disabled: !isSortable,
	});
	const dropTarget = useDroppable({ id: `${SECTION_DROP_PREFIX}:${section._id}` });

	const style = isSortable
		? {
				transform: CSS.Transform.toString(sortable.transform),
				transition: sortable.transition,
			}
		: undefined;

	const isOverForTable = isDraggingTable && (sortable.isOver || dropTarget.isOver);
	const outlineClass = isOverForTable
		? "border-2 border-dashed border-primary"
		: "border-2 border-dashed border-border";
	const isDefault = section.isSystem === true;

	const setRef = (node: HTMLDivElement | null) => {
		sortable.setNodeRef(node);
	};

	return (
		<div
			ref={setRef}
			style={style}
			className={`rounded-xl ${outlineClass} bg-background/50 p-3 space-y-3 ${
				sortable.isDragging ? "opacity-60" : ""
			}`}
		>
			<div className="flex items-center gap-2">
				{isSortable ? (
					<button
						type="button"
						className="p-1 rounded text-faint-foreground hover:text-foreground hover:bg-hover cursor-grab active:cursor-grabbing touch-none"
						title={translations.dragHandle}
						aria-label={translations.dragHandle}
						{...sortable.attributes}
						{...sortable.listeners}
					>
						<GripVertical size={16} />
					</button>
				) : (
					<span className="w-6" aria-hidden="true" />
				)}
				{isEditing ? (
					<div className="flex items-center gap-2 flex-1">
						{renameInput}
						<button
							onClick={onSubmitRename}
							className="p-1.5 rounded-md hover:bg-hover text-success"
							title={translations.save}
						>
							<Check size={16} />
						</button>
						<button
							onClick={onCancelRename}
							className="p-1.5 rounded-md hover:bg-hover text-faint-foreground"
							title={translations.cancel}
						>
							<X size={16} />
						</button>
					</div>
				) : (
					<>
						<h4 className="text-sm font-semibold text-foreground">{sectionLabel}</h4>
						{isDefault && (
							<span className="text-xs px-2 py-0.5 rounded-full bg-muted text-faint-foreground border border-border">
								{translations.defaultBadge}
							</span>
						)}
						<span className="text-xs text-faint-foreground">{translations.tableCount}</span>
						<div className="ml-auto flex items-center gap-1">
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
				aria-label={section.name ?? translations.defaultBadge}
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

			<button
				type="button"
				onClick={onAddTable}
				className="w-full flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-xs font-medium border border-dashed border-border hover:bg-hover text-faint-foreground hover:text-foreground"
			>
				<Plus size={14} />
				{translations.addTable}
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
	labels: {
		table: string;
		seatsFormat: string;
		editTitle: string;
		removeTitle: string;
		activateTitle: string;
		moveTableAria: string;
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
		labels,
	} = props;
	const draggable = useDraggable({ id: `${TABLE_DRAG_PREFIX}:${table._id}` });
	const style = {
		transform: CSS.Translate.toString(draggable.transform),
		opacity: draggable.isDragging ? 0.5 : 1,
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
				<button
					onClick={onStartEdit}
					className="p-1.5 rounded-md hover:bg-hover text-muted-foreground"
					title={labels.editTitle}
				>
					<Pencil size={16} />
				</button>
				<button
					onClick={onToggleActive}
					className="p-1.5 rounded-md hover:bg-hover text-success"
					title={labels.activateTitle}
				>
					{table.isActive ? (
						<ToggleRight size={20} />
					) : (
						<ToggleLeft size={20} className="text-faint-foreground" />
					)}
				</button>
				<button
					onClick={onRemove}
					className="p-1.5 rounded-md hover:bg-hover text-destructive"
					title={labels.removeTitle}
				>
					<Trash2 size={16} />
				</button>
			</div>
		</div>
	);
}
