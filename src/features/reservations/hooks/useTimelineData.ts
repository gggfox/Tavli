import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { useMemo } from "react";
import { unwrapResult, type UnwrappedValue } from "@/global/utils";
import type { FunctionReturnType } from "convex/server";
import { dashboardReservationBounds, type ReservationRange } from "@/features/reservations/utils";

type TableDoc = Doc<"tables">;
type SectionDoc = Doc<"sections">;
type ReservationDoc = Doc<"reservations">;
type TableLockDoc = UnwrappedValue<
	FunctionReturnType<typeof api.tableLocks.listForRestaurant>
>[number];

export interface TimelineSection {
	section: SectionDoc;
	tables: TableDoc[];
}

export interface TimelineData {
	sections: TimelineSection[];
	reservationsByTable: Map<string, ReservationDoc[]>;
	unassignedReservations: ReservationDoc[];
	locksByTable: Map<string, TableLockDoc[]>;
	openHour: number;
	closeHour: number;
	isLoading: boolean;
}

function parseHourFromHHMM(hhmm: string | undefined, fallback: number): number {
	if (!hhmm) return fallback;
	const parts = hhmm.split(":");
	const h = Number.parseInt(parts[0] ?? "0", 10);
	if (Number.isNaN(h) || h < 0 || h > 23) return fallback;
	return h;
}

export function useTimelineData(
	restaurantId: Id<"restaurants"> | null,
	restaurant: Doc<"restaurants"> | null,
	range: ReservationRange,
	customDay: string | undefined
): TimelineData {
	const bounds = useMemo(() => dashboardReservationBounds(range, customDay), [range, customDay]);

	const reservationsQuery = useQuery({
		...convexQuery(
			api.reservations.listForRange,
			restaurantId ? { restaurantId, fromMs: bounds.fromMs, toMs: bounds.toMs } : "skip"
		),
		enabled: Boolean(restaurantId),
		select: unwrapResult<ReservationDoc[]>,
	});

	const tablesQuery = useQuery({
		...convexQuery(api.tables.getActiveByRestaurant, restaurantId ? { restaurantId } : "skip"),
		enabled: Boolean(restaurantId),
	});

	const sectionsQuery = useQuery({
		...convexQuery(api.sections.getByRestaurant, restaurantId ? { restaurantId } : "skip"),
		enabled: Boolean(restaurantId),
	});

	const locksQuery = useQuery({
		...convexQuery(
			api.tableLocks.listForRestaurant,
			restaurantId ? { restaurantId, fromMs: bounds.fromMs, toMs: bounds.toMs } : "skip"
		),
		enabled: Boolean(restaurantId),
		select: unwrapResult<TableLockDoc[]>,
	});

	const openHour = parseHourFromHHMM(restaurant?.openTime, 10);
	const closeHour = parseHourFromHHMM(restaurant?.closeTime, 23);

	const sections = useMemo((): TimelineSection[] => {
		const sectionDocs = sectionsQuery.data ?? [];
		const tables = tablesQuery.data ?? [];

		const tablesBySection = new Map<string, TableDoc[]>();
		const unsectioned: TableDoc[] = [];

		for (const table of tables) {
			if (table.sectionId) {
				const key = table.sectionId as string;
				const list = tablesBySection.get(key);
				if (list) list.push(table);
				else tablesBySection.set(key, [table]);
			} else {
				unsectioned.push(table);
			}
		}

		const result: TimelineSection[] = [];
		for (const section of sectionDocs) {
			if (!section.isActive) continue;
			const sectionTables = tablesBySection.get(section._id as string) ?? [];
			if (sectionTables.length === 0) continue;
			sectionTables.sort((a, b) => a.tableNumber - b.tableNumber);
			result.push({ section, tables: sectionTables });
		}

		if (unsectioned.length > 0) {
			unsectioned.sort((a, b) => a.tableNumber - b.tableNumber);
			result.push({
				section: {
					_id: "__unsectioned__" as Id<"sections">,
					_creationTime: 0,
					restaurantId: restaurantId!,
					name: undefined,
					displayOrder: 9999,
					isActive: true,
					createdAt: 0,
					updatedAt: 0,
				} as unknown as SectionDoc,
				tables: unsectioned,
			});
		}

		return result;
	}, [sectionsQuery.data, tablesQuery.data, restaurantId]);

	const { reservationsByTable, unassignedReservations } = useMemo(() => {
		const reservations = reservationsQuery.data ?? [];
		const byTable = new Map<string, ReservationDoc[]>();
		const unassigned: ReservationDoc[] = [];

		for (const r of reservations) {
			if (r.tableIds.length === 0) {
				unassigned.push(r);
			} else {
				for (const tableId of r.tableIds) {
					const key = tableId as string;
					const list = byTable.get(key);
					if (list) list.push(r);
					else byTable.set(key, [r]);
				}
			}
		}

		unassigned.sort((a, b) => a.startsAt - b.startsAt);
		for (const list of byTable.values()) {
			list.sort((a, b) => a.startsAt - b.startsAt);
		}

		return { reservationsByTable: byTable, unassignedReservations: unassigned };
	}, [reservationsQuery.data]);

	const locksByTable = useMemo(() => {
		const locks = locksQuery.data ?? [];
		const byTable = new Map<string, TableLockDoc[]>();
		for (const lock of locks) {
			const key = lock.tableId as string;
			const list = byTable.get(key);
			if (list) list.push(lock);
			else byTable.set(key, [lock]);
		}
		return byTable;
	}, [locksQuery.data]);

	return {
		sections,
		reservationsByTable,
		unassignedReservations,
		locksByTable,
		openHour,
		closeHour,
		isLoading:
			reservationsQuery.isLoading ||
			tablesQuery.isLoading ||
			sectionsQuery.isLoading ||
			locksQuery.isLoading,
	};
}
