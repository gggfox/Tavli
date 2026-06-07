import { RestaurantsKeys } from "@/global/i18n";
import { useConvexMutate } from "@/global/hooks";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

interface UseFloorPlanOptions {
	showTrash: boolean;
	showInactive: boolean;
}

export function useFloorPlan(
	restaurantId: Id<"restaurants">,
	{ showTrash, showInactive }: UseFloorPlanOptions
) {
	const { t } = useTranslation();

	const { data: tables } = useQuery(convexQuery(api.tables.getByRestaurant, { restaurantId }));
	const { data: sections } = useQuery(convexQuery(api.sections.getByRestaurant, { restaurantId }));

	const { data: deletedTables = [] } = useQuery({
		...convexQuery(api.tables.getDeletedForRestaurant, { restaurantId }),
		enabled: showTrash,
	});
	const { data: deletedSections = [] } = useQuery({
		...convexQuery(api.sections.getDeletedForRestaurant, { restaurantId }),
		enabled: showTrash,
	});

	const createTable = useConvexMutate(api.tables.create);
	const updateTable = useConvexMutate(api.tables.update);
	const toggleActive = useConvexMutate(api.tables.toggleActive);
	const removeTable = useConvexMutate(api.tables.remove);
	const bulkRemoveTables = useConvexMutate(api.tables.bulkRemove);
	const restoreTable = useConvexMutate(api.tables.restore);

	const createSection = useConvexMutate(api.sections.create);
	const updateSection = useConvexMutate(api.sections.update);
	const removeSection = useConvexMutate(api.sections.remove);
	const restoreSection = useConvexMutate(api.sections.restore);
	const assignTableSection = useConvexMutate(api.sections.assignTable);

	const sectionsList = useMemo(() => sections ?? [], [sections]);

	const sectionLabel = useCallback(
		(section: Doc<"sections">, fallbackIndex: number): string => {
			if (section.name && section.name.length > 0) return section.name;
			return t(RestaurantsKeys.SECTIONS_UNNAMED, { number: fallbackIndex + 1 });
		},
		[t]
	);

	const inactiveCount = useMemo(() => (tables ?? []).filter((tt) => !tt.isActive).length, [tables]);

	const visibleTableIds = useMemo(() => {
		const ids = new Set<Id<"tables">>();
		for (const table of tables ?? []) {
			if (showInactive || table.isActive) ids.add(table._id);
		}
		return ids;
	}, [tables, showInactive]);

	const nextTableNumber = useMemo(
		() => (tables ?? []).reduce((max, tt) => Math.max(max, tt.tableNumber), 0) + 1,
		[tables]
	);

	const buildTablesBySection = useCallback(
		(
			tableSectionOverrides: Map<Id<"tables">, Id<"sections">>
		): { byId: Map<string, Doc<"tables">[]>; unassigned: Doc<"tables">[] } => {
			const byId = new Map<string, Doc<"tables">[]>();
			const unassigned: Doc<"tables">[] = [];
			for (const table of tables ?? []) {
				const override = tableSectionOverrides.get(table._id);
				const sectionId = override ?? table.sectionId;
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
		},
		[tables]
	);

	return {
		tables: tables ?? [],
		sectionsList,
		deletedTables,
		deletedSections,
		sectionLabel,
		inactiveCount,
		visibleTableIds,
		nextTableNumber,
		buildTablesBySection,
		createTable: createTable.mutateAsync,
		updateTable: updateTable.mutateAsync,
		toggleActive: toggleActive.mutateAsync,
		removeTable: removeTable.mutateAsync,
		bulkRemoveTables: bulkRemoveTables.mutateAsync,
		restoreTable: restoreTable.mutateAsync,
		createSection: createSection.mutateAsync,
		updateSection: updateSection.mutateAsync,
		removeSection: removeSection.mutateAsync,
		restoreSection: restoreSection.mutateAsync,
		assignTableSection: assignTableSection.mutateAsync,
		isBulkRemovePending: bulkRemoveTables.isPending,
	};
}
