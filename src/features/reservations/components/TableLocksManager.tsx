/**
 * Manage time-windowed locks on tables. Owners and managers can take a
 * table out of service for a window (maintenance, private events, etc.).
 *
 * Conflict policy is enforced server-side: locking a window that already
 * has an active reservation returns ERROR_TABLE_HAS_RESERVATIONS, surfaced
 * here as an inline error.
 */
import { InlineError } from "@/global/components";
import { unwrapQuery, unwrapResult } from "@/global/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { Lock, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
	formatReservationTime,
	fromDateTimeLocalValue,
	toDateTimeLocalValue,
} from "../utils";

interface TableLocksManagerProps {
	restaurantId: Id<"restaurants">;
}

export function TableLocksManager({ restaurantId }: Readonly<TableLocksManagerProps>) {
	const { data: rawTables } = useQuery(
		convexQuery(api.tables.getByRestaurant, { restaurantId })
	);
	const tables = (rawTables ?? []) as Doc<"tables">[];

	const { data: rawLocks } = useQuery(
		convexQuery(api.tableLocks.listForRestaurant, { restaurantId })
	);
	const { data: locks } = unwrapQuery(rawLocks);

	const createLock = useMutation({
		mutationFn: useConvexMutation(api.tableLocks.create),
	});
	const removeLock = useMutation({
		mutationFn: useConvexMutation(api.tableLocks.remove),
	});

	const [tableId, setTableId] = useState<Id<"tables"> | "">("");
	const [startsAtMs, setStartsAtMs] = useState<number>(() => Date.now());
	const [endsAtMs, setEndsAtMs] = useState<number>(() => Date.now() + 2 * 60 * 60 * 1000);
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);

	const tableLabelFor = useMemo(
		() => (id: Id<"tables">) => {
			const t = tables.find((tt) => tt._id === id);
			return t ? `Table ${t.tableNumber}${t.label ? ` · ${t.label}` : ""}` : id;
		},
		[tables]
	);

	const handleCreate = async () => {
		setError(null);
		if (!tableId) {
			setError("Pick a table");
			return;
		}
		try {
			unwrapResult(
				await createLock.mutateAsync({
					tableId: tableId as Id<"tables">,
					startsAt: startsAtMs,
					endsAt: endsAtMs,
					reason: reason || undefined,
				})
			);
			setReason("");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create lock");
		}
	};

	const handleRemove = async (lockId: Id<"tableLocks">) => {
		setError(null);
		try {
			unwrapResult(await removeLock.mutateAsync({ lockId }));
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to remove lock");
		}
	};

	return (
		<div className="space-y-4">
			{error && <InlineError message={error} onDismiss={() => setError(null)} />}

			<div
				className="rounded-lg p-4 space-y-3"
				style={{ backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-default)" }}
			>
				<h3 className="text-sm font-medium">New lock</h3>
				<div className="flex flex-wrap gap-2 items-end">
					<label htmlFor="lock-table" className="flex flex-col gap-1 text-xs">
						<span style={{ color: "var(--text-secondary)" }}>Table</span>
						<select
							id="lock-table"
							value={tableId}
							onChange={(e) => setTableId(e.target.value as Id<"tables">)}
							className="rounded-md px-3 py-2 text-sm"
							style={{
								backgroundColor: "var(--bg-primary)",
								border: "1px solid var(--border-default)",
								color: "var(--text-primary)",
							}}
						>
							<option value="">Select…</option>
							{tables
								.filter((t) => t.isActive)
								.map((t) => (
									<option key={t._id} value={t._id}>
										{tableLabelFor(t._id)}
									</option>
								))}
						</select>
					</label>
					<label htmlFor="lock-start" className="flex flex-col gap-1 text-xs">
						<span style={{ color: "var(--text-secondary)" }}>Starts at</span>
						<input
							id="lock-start"
							type="datetime-local"
							value={toDateTimeLocalValue(startsAtMs)}
							onChange={(e) => setStartsAtMs(fromDateTimeLocalValue(e.target.value))}
							className="rounded-md px-3 py-2 text-sm"
							style={{
								backgroundColor: "var(--bg-primary)",
								border: "1px solid var(--border-default)",
								color: "var(--text-primary)",
							}}
						/>
					</label>
					<label htmlFor="lock-end" className="flex flex-col gap-1 text-xs">
						<span style={{ color: "var(--text-secondary)" }}>Ends at</span>
						<input
							id="lock-end"
							type="datetime-local"
							value={toDateTimeLocalValue(endsAtMs)}
							onChange={(e) => setEndsAtMs(fromDateTimeLocalValue(e.target.value))}
							className="rounded-md px-3 py-2 text-sm"
							style={{
								backgroundColor: "var(--bg-primary)",
								border: "1px solid var(--border-default)",
								color: "var(--text-primary)",
							}}
						/>
					</label>
					<label htmlFor="lock-reason" className="flex flex-col gap-1 text-xs">
						<span style={{ color: "var(--text-secondary)" }}>Reason</span>
						<input
							id="lock-reason"
							type="text"
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							placeholder="Maintenance"
							className="rounded-md px-3 py-2 text-sm"
							style={{
								backgroundColor: "var(--bg-primary)",
								border: "1px solid var(--border-default)",
								color: "var(--text-primary)",
							}}
						/>
					</label>
					<button
						type="button"
						onClick={handleCreate}
						className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
					>
						<Plus size={14} /> Add lock
					</button>
				</div>
			</div>

			<div className="space-y-2">
				{(locks ?? []).map((lock) => (
					<div
						key={lock._id}
						className="flex items-center justify-between gap-4 rounded-lg px-4 py-3 text-sm"
						style={{
							backgroundColor: "var(--bg-secondary)",
							border: "1px solid var(--border-default)",
						}}
					>
						<div className="flex items-center gap-3 min-w-0">
							<Lock size={14} style={{ color: "var(--text-muted)" }} />
							<span style={{ color: "var(--text-primary)" }}>{tableLabelFor(lock.tableId)}</span>
							<span className="text-xs" style={{ color: "var(--text-muted)" }}>
								{formatReservationTime(lock.startsAt)} → {formatReservationTime(lock.endsAt)}
							</span>
							{lock.reason && (
								<span className="text-xs" style={{ color: "var(--text-secondary)" }}>
									· {lock.reason}
								</span>
							)}
						</div>
						<button
							type="button"
							onClick={() => handleRemove(lock._id)}
							className="p-2 rounded-md"
							aria-label="Remove lock"
						>
							<Trash2 size={14} style={{ color: "var(--accent-danger)" }} />
						</button>
					</div>
				))}
				{(locks ?? []).length === 0 && (
					<p className="text-sm" style={{ color: "var(--text-muted)" }}>
						No locks. Add one above to take a table out of service for a window.
					</p>
				)}
			</div>
		</div>
	);
}
