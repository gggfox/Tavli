/**
 * Table picker shown when staff confirm a reservation.
 *
 * Lists active tables for the restaurant. For each, runs a per-window check
 * to grey out tables that are locked or already reserved during the
 * reservation's [startsAt, endsAt) window. Selection is multi-select so
 * large parties can occupy multiple tables.
 */
import { ReservationsKeys } from "@/global/i18n";
import { unwrapResult, type UnwrappedValue } from "@/global/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Doc, Id } from "convex/_generated/dataModel";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

type WindowReservations = UnwrappedValue<
	FunctionReturnType<typeof api.reservations.listForRange>
>;
type Locks = UnwrappedValue<FunctionReturnType<typeof api.tableLocks.listForRestaurant>>;

interface TablePickerForReservationProps {
	restaurantId: Id<"restaurants">;
	startsAt: number;
	endsAt: number;
	partySize: number;
	excludeReservationId?: Id<"reservations">;
	value: Id<"tables">[];
	onChange: (next: Id<"tables">[]) => void;
}

export function TablePickerForReservation(props: Readonly<TablePickerForReservationProps>) {
	const { t } = useTranslation();
	const { data: rawTables } = useQuery(
		convexQuery(api.tables.getByRestaurant, { restaurantId: props.restaurantId })
	);
	const tables = (rawTables ?? []) as Doc<"tables">[];

	// We rely on the server-side conflict re-check at confirm time for
	// correctness. The picker just shows availability based on the same
	// reservation list the dashboard already has -- if a conflicting
	// reservation appears mid-edit, the confirm mutation will reject.
	const { data: windowReservations } = useQuery({
		...convexQuery(api.reservations.listForRange, {
			restaurantId: props.restaurantId,
			fromMs: Math.min(props.startsAt - 24 * 60 * 60 * 1000, props.startsAt),
			toMs: props.endsAt + 1,
		}),
		select: unwrapResult<WindowReservations>,
	});

	const { data: locks } = useQuery({
		...convexQuery(api.tableLocks.listForRestaurant, {
			restaurantId: props.restaurantId,
			fromMs: props.startsAt,
			toMs: props.endsAt,
		}),
		select: unwrapResult<Locks>,
	});

	const isConflicting = (tableId: Id<"tables">) => {
		const overlapping = (windowReservations ?? []).some((r) => {
			if (props.excludeReservationId && r._id === props.excludeReservationId) return false;
			if (r.status === "cancelled" || r.status === "no_show") return false;
			if (!r.tableIds.includes(tableId)) return false;
			return r.startsAt < props.endsAt && r.endsAt > props.startsAt;
		});
		return overlapping;
	};
	const isLocked = (tableId: Id<"tables">) => {
		return (locks ?? []).some(
			(lock) =>
				lock.tableId === tableId && lock.startsAt < props.endsAt && lock.endsAt > props.startsAt
		);
	};

	const selectedSet = new Set(props.value);
	const toggle = (tableId: Id<"tables">) => {
		if (selectedSet.has(tableId)) {
			props.onChange(props.value.filter((id) => id !== tableId));
		} else {
			props.onChange([...props.value, tableId]);
		}
	};

	const sorted = [...tables]
		.filter((t) => t.isActive)
		.sort((a, b) => a.tableNumber - b.tableNumber);

	const totalSelectedCapacity = props.value
		.map((id) => tables.find((t) => t._id === id)?.capacity ?? 0)
		.reduce((sum, c) => sum + c, 0);

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between text-xs text-muted-foreground">
				<span >
					{t(ReservationsKeys.PICKER_SELECTED_CAPACITY, {
						capacity: totalSelectedCapacity,
						partySize: props.partySize,
					})}
				</span>
				{totalSelectedCapacity < props.partySize && (
					<span className="text-warning" >
						{t(ReservationsKeys.PICKER_NEED_MORE_SEATS, {
							count: props.partySize - totalSelectedCapacity,
						})}
					</span>
				)}
			</div>
			<div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
				{sorted.map((table) => {
					const conflicting = isConflicting(table._id);
					const locked = isLocked(table._id);
					const selected = selectedSet.has(table._id);
					const disabled = conflicting || locked;
					const seatsLabel = t(ReservationsKeys.PICKER_SEATS, {
						count: table.capacity ?? 0,
					});
					return (
						<button
							key={table._id}
							type="button"
							onClick={() => !disabled && toggle(table._id)}
							className="flex flex-col items-start gap-1 rounded-lg px-3 py-2 text-left text-sm"
							style={{backgroundColor: selected
									? "var(--btn-primary-bg)"
									: "var(--bg-secondary)",
				color: selected ? "var(--btn-primary-fg, white)" : "var(--text-primary)",
				border: `1px solid ${
									selected ? "var(--btn-primary-bg)" : "var(--border-default)"
								}`,
				opacity: disabled ? 0.45 : 1,
				cursor: disabled ? "not-allowed" : "pointer"}}
							aria-pressed={selected}
							disabled={disabled}
						>
							<span className="flex items-center gap-1 font-medium">
								{t(ReservationsKeys.TABLE_LABEL_PREFIX)} {table.tableNumber}
								{locked && <Lock size={12} />}
							</span>
							<span className="text-xs opacity-80">
								{seatsLabel}
								{conflicting && t(ReservationsKeys.PICKER_RESERVED_SUFFIX)}
								{locked && t(ReservationsKeys.PICKER_LOCKED_SUFFIX)}
								{table.label && ` · ${table.label}`}
							</span>
						</button>
					);
				})}
				{sorted.length === 0 && (
					<p className="text-sm text-faint-foreground" >
						{t(ReservationsKeys.PICKER_NO_TABLES)}
					</p>
				)}
			</div>
		</div>
	);
}
