import {
	COLS_GRID_CLASS,
	SECTION_DRAG_PREFIX,
	SECTION_DROP_PREFIX,
	TABLE_DRAG_PREFIX,
	gridColumnsForCount,
} from "@/features/restaurants/utils/tableLayout";
import { RestaurantsKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils";
import {
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
	type DragEndEvent,
	type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { Doc, Id } from "convex/_generated/dataModel";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SectionDragGhost, TableDragGhost } from "../components/tables/DragGhosts";

interface UseTablesDndParams {
	tables: Doc<"tables">[];
	sectionsList: Doc<"sections">[];
	buildTablesBySection: (overrides: Map<Id<"tables">, Id<"sections">>) => {
		byId: Map<string, Doc<"tables">[]>;
		unassigned: Doc<"tables">[];
	};
	sectionLabel: (section: Doc<"sections">, fallbackIndex: number) => string;
	assignTableSection: (args: {
		tableId: Id<"tables">;
		sectionId: Id<"sections">;
	}) => Promise<unknown>;
	updateSection: (args: { sectionId: Id<"sections">; displayOrder?: number }) => Promise<unknown>;
	setMutationError: (err: unknown, fallbackKey: string) => void;
	clearError: () => void;
	selectionMode: boolean;
	onCloseKebab: () => void;
}

export function useTablesDnd({
	tables,
	sectionsList,
	buildTablesBySection,
	sectionLabel,
	assignTableSection,
	updateSection,
	setMutationError,
	clearError,
	selectionMode,
	onCloseKebab,
}: UseTablesDndParams) {
	const { t } = useTranslation();

	const [activeDragId, setActiveDragId] = useState<string | null>(null);
	const [tableSectionOverrides, setTableSectionOverrides] = useState<
		Map<Id<"tables">, Id<"sections">>
	>(() => new Map());
	const [sectionOrderOverride, setSectionOrderOverride] = useState<Id<"sections">[] | null>(null);

	useEffect(() => {
		if (tableSectionOverrides.size === 0 || tables.length === 0) return;
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
		if (!sectionOrderOverride || sectionsList.length === 0) return;
		const serverOrder = sectionsList.map((s) => s._id).join("|");
		const localOrder = sectionOrderOverride.join("|");
		if (serverOrder === localOrder) setSectionOrderOverride(null);
	}, [sectionsList, sectionOrderOverride]);

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

	const effectiveSectionIdForTable = useCallback(
		(table: Doc<"tables">): Id<"sections"> | undefined => {
			const override = tableSectionOverrides.get(table._id);
			return override ?? table.sectionId;
		},
		[tableSectionOverrides]
	);

	const tablesBySection = useMemo(
		() => buildTablesBySection(tableSectionOverrides),
		[buildTablesBySection, tableSectionOverrides]
	);

	const cols = gridColumnsForCount(orderedSections.length);
	const gridClass = COLS_GRID_CLASS[cols];
	const isDraggingTable = activeDragId?.startsWith(TABLE_DRAG_PREFIX + ":") ?? false;

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
	);

	const handleMoveTableToSection = useCallback(
		async (tableId: Id<"tables">, nextSectionId: Id<"sections">) => {
			clearError();
			setTableSectionOverrides((prev) => {
				const next = new Map(prev);
				next.set(tableId, nextSectionId);
				return next;
			});
			try {
				unwrapResult(await assignTableSection({ tableId, sectionId: nextSectionId }));
			} catch (err) {
				setTableSectionOverrides((prev) => {
					const next = new Map(prev);
					next.delete(tableId);
					return next;
				});
				setMutationError(err, RestaurantsKeys.SECTIONS_ASSIGN_FAILED);
			}
		},
		[assignTableSection, clearError, setMutationError]
	);

	const reorderSections = useCallback(
		async (orderedIds: Id<"sections">[]) => {
			clearError();
			setSectionOrderOverride(orderedIds);
			try {
				await Promise.all(
					orderedIds.map((sectionId, index) =>
						updateSection({ sectionId, displayOrder: index }).then((r) => unwrapResult(r))
					)
				);
			} catch (err) {
				setSectionOrderOverride(null);
				setMutationError(err, RestaurantsKeys.SECTIONS_REORDER_FAILED);
			}
		},
		[clearError, setMutationError, updateSection]
	);

	const handleDragStart = useCallback(
		(event: DragStartEvent) => {
			const activeId = String(event.active.id);
			if (selectionMode && activeId.startsWith(TABLE_DRAG_PREFIX + ":")) return;
			setActiveDragId(activeId);
			onCloseKebab();
		},
		[onCloseKebab, selectionMode]
	);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
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
				const table = tables.find((tt) => tt._id === tableId);
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
			}
		},
		[
			effectiveSectionIdForTable,
			handleMoveTableToSection,
			orderedSections,
			reorderSections,
			selectionMode,
			tables,
		]
	);

	const handleDragCancel = useCallback(() => setActiveDragId(null), []);

	const dragOverlayContent = useMemo(() => {
		if (!activeDragId) return null;
		if (activeDragId.startsWith(TABLE_DRAG_PREFIX + ":")) {
			const tableId = activeDragId.slice(TABLE_DRAG_PREFIX.length + 1) as Id<"tables">;
			const table = tables.find((tt) => tt._id === tableId);
			if (!table) return null;
			return <TableDragGhost table={table} />;
		}
		if (activeDragId.startsWith(SECTION_DRAG_PREFIX + ":")) {
			const sectionId = activeDragId.slice(SECTION_DRAG_PREFIX.length + 1) as Id<"sections">;
			const idx = orderedSections.findIndex((s) => s._id === sectionId);
			const section = idx >= 0 ? orderedSections[idx] : undefined;
			if (!section) return null;
			const count = (tablesBySection.byId.get(section._id) ?? []).length;
			return (
				<SectionDragGhost
					label={sectionLabel(section, idx)}
					countText={t(RestaurantsKeys.SECTIONS_TABLE_COUNT_SHORT, { count })}
				/>
			);
		}
		return null;
	}, [activeDragId, tables, orderedSections, tablesBySection, sectionLabel, t]);

	return {
		orderedSections,
		tablesBySection,
		gridClass,
		isDraggingTable,
		sensors,
		handleDragStart,
		handleDragEnd,
		handleDragCancel,
		handleMoveTableToSection,
		dragOverlayContent,
		sortableSectionIds: orderedSections.map((s) => `${SECTION_DRAG_PREFIX}:${s._id}`),
	};
}
