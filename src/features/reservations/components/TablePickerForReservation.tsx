/**
 * Table picker shown when staff confirm a reservation.
 *
 * Lists active tables for the restaurant. For each, runs a per-window check
 * to grey out tables that are locked or already reserved during the
 * reservation's [startsAt, endsAt) window. Selection is multi-select so
 * large parties can occupy multiple tables.
 */
import { unwrapQuery } from "@/global/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { Lock } from "lucide-react";

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
	const { data: rawTables } = useQuery(
		convexQuery(api.tables.getByRestaurant, { restaurantId: props.restaurantId })
	);
	const tables = (rawTables ?? []) as Doc<"tables">[];

	// We rely on the server-side conflict re-check at confirm time for
	// correctness. The picker just shows availability based on the same
	// reservation list the dashboard already has -- if a conflicting
	// reservation appears mid-edit, the confirm mutation will reject.
	const { data: rawWindowReservations } = useQuery(
		convexQuery(api.reservations.listForRange, {
			restaurantId: props.restaurantId,
			fromMs: Math.min(props.startsAt - 24 * 60 * 60 * 1000, props.startsAt),
			toMs: props.endsAt + 1,
		})
	);
	const { data: windowReservations } = unwrapQuery(rawWindowReservations);

	const { data: rawLocks } = useQuery(
		convexQuery(api.tableLocks.listForRestaurant, {
			restaurantId: props.restaurantId,
			fromMs: props.startsAt,
			toMs: props.endsAt,
		})
	);
	const { data: locks } = unwrapQuery(rawLocks);

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
			<div className="flex items-center justify-between text-xs">
				<span style={{ color: "var(--text-secondary)" }}>
					Selected capacity: {totalSelectedCapacity} / {props.partySize}
				</span>
				{totalSelectedCapacity < props.partySize && (
					<span style={{ color: "var(--accent-warning)" }}>
						Need {props.partySize - totalSelectedCapacity} more seats
					</span>
				)}
			</div>
			<div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
				{sorted.map((table) => {
					const conflicting = isConflicting(table._id);
					const locked = isLocked(table._id);
					const selected = selectedSet.has(table._id);
					const disabled = conflicting || locked;
					return (
						<button
							key={table._id}
							type="button"
							onClick={() => !disabled && toggle(table._id)}
							className="flex flex-col items-start gap-1 rounded-lg px-3 py-2 text-left text-sm"
							style={{
								backgroundColor: selected
									? "var(--btn-primary-bg)"
									: "var(--bg-secondary)",
								color: selected ? "var(--btn-primary-fg, white)" : "var(--text-primary)",
								border: `1px solid ${
									selected ? "var(--btn-primary-bg)" : "var(--border-default)"
								}`,
								opacity: disabled ? 0.45 : 1,
								cursor: disabled ? "not-allowed" : "pointer",
							}}
							aria-pressed={selected}
							disabled={disabled}
						>
							<span className="flex items-center gap-1 font-medium">
								Table {table.tableNumber}
								{locked && <Lock size={12} />}
							</span>
							<span className="text-xs opacity-80">
								{table.capacity ?? "?"} seats
								{conflicting && " · reserved"}
								{locked && " · locked"}
								{table.label && ` · ${table.label}`}
							</span>
						</button>
					);
				})}
				{sorted.length === 0 && (
					<p className="text-sm" style={{ color: "var(--text-muted)" }}>
						No active tables.
					</p>
				)}
			</div>
		</div>
	);
}
