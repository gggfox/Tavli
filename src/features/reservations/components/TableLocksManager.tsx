/**
 * Manage time-windowed locks on tables. Owners and managers can take a
 * table out of service for a window (maintenance, private events, etc.).
 *
 * Conflict policy is enforced server-side: locking a window that already
 * has an active reservation returns ERROR_TABLE_HAS_RESERVATIONS, surfaced
 * here as an inline error.
 */
import { InlineError } from "@/global/components";
import { ReservationsKeys } from "@/global/i18n";
import { unwrapResult, type UnwrappedValue } from "@/global/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Doc, Id } from "convex/_generated/dataModel";
import { Lock, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	formatReservationTime,
	fromDateTimeLocalValue,
	toDateTimeLocalValue,
} from "../utils";

type LocksValue = UnwrappedValue<FunctionReturnType<typeof api.tableLocks.listForRestaurant>>;

interface TableLocksManagerProps {
	restaurantId: Id<"restaurants">;
}

export function TableLocksManager({ restaurantId }: Readonly<TableLocksManagerProps>) {
	const { t, i18n } = useTranslation();
	const { data: rawTables } = useQuery(
		convexQuery(api.tables.getByRestaurant, { restaurantId })
	);
	const tables = (rawTables ?? []) as Doc<"tables">[];

	const { data: locks } = useQuery({
		...convexQuery(api.tableLocks.listForRestaurant, { restaurantId }),
		select: unwrapResult<LocksValue>,
	});

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
			const table = tables.find((tt) => tt._id === id);
			if (!table) return id;
			const base = t(ReservationsKeys.LOCKS_TABLE_FORMAT, { number: table.tableNumber });
			return table.label ? `${base} · ${table.label}` : base;
		},
		[tables, t]
	);

	const handleCreate = async () => {
		setError(null);
		if (!tableId) {
			setError(t(ReservationsKeys.LOCKS_PICK_TABLE_ERROR));
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
			setError(err instanceof Error ? err.message : t(ReservationsKeys.LOCKS_CREATE_ERROR));
		}
	};

	const handleRemove = async (lockId: Id<"tableLocks">) => {
		setError(null);
		try {
			unwrapResult(await removeLock.mutateAsync({ lockId }));
		} catch (err) {
			setError(err instanceof Error ? err.message : t(ReservationsKeys.LOCKS_REMOVE_ERROR));
		}
	};

	return (
		<div className="space-y-4">
			{error && <InlineError message={error} onDismiss={() => setError(null)} />}

			<div
				className="rounded-lg p-4 space-y-3 bg-muted border border-border"
				
			>
				<h3 className="text-sm font-medium">{t(ReservationsKeys.LOCKS_NEW_LOCK)}</h3>
				<div className="flex flex-wrap gap-2 items-end">
					<label htmlFor="lock-table" className="flex flex-col gap-1 text-xs text-muted-foreground">
						<span >
							{t(ReservationsKeys.LOCKS_TABLE_LABEL)}
						</span>
						<select
							id="lock-table"
							value={tableId}
							onChange={(e) => setTableId(e.target.value as Id<"tables">)}
							className="rounded-md px-3 py-2 text-sm bg-background border border-border text-foreground"
							
						>
							<option value="">{t(ReservationsKeys.LOCKS_TABLE_PLACEHOLDER)}</option>
							{tables
								.filter((tab) => tab.isActive)
								.map((tab) => (
									<option key={tab._id} value={tab._id}>
										{tableLabelFor(tab._id)}
									</option>
								))}
						</select>
					</label>
					<label htmlFor="lock-start" className="flex flex-col gap-1 text-xs text-muted-foreground">
						<span >
							{t(ReservationsKeys.LOCKS_STARTS_AT)}
						</span>
						<input
							id="lock-start"
							type="datetime-local"
							value={toDateTimeLocalValue(startsAtMs)}
							onChange={(e) => setStartsAtMs(fromDateTimeLocalValue(e.target.value))}
							className="rounded-md px-3 py-2 text-sm bg-background border border-border text-foreground"
							
						/>
					</label>
					<label htmlFor="lock-end" className="flex flex-col gap-1 text-xs text-muted-foreground">
						<span >
							{t(ReservationsKeys.LOCKS_ENDS_AT)}
						</span>
						<input
							id="lock-end"
							type="datetime-local"
							value={toDateTimeLocalValue(endsAtMs)}
							onChange={(e) => setEndsAtMs(fromDateTimeLocalValue(e.target.value))}
							className="rounded-md px-3 py-2 text-sm bg-background border border-border text-foreground"
							
						/>
					</label>
					<label htmlFor="lock-reason" className="flex flex-col gap-1 text-xs text-muted-foreground">
						<span >
							{t(ReservationsKeys.LOCKS_REASON)}
						</span>
						<input
							id="lock-reason"
							type="text"
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							placeholder={t(ReservationsKeys.LOCKS_REASON_PLACEHOLDER)}
							className="rounded-md px-3 py-2 text-sm bg-background border border-border text-foreground"
							
						/>
					</label>
					<button
						type="button"
						onClick={handleCreate}
						className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
					>
						<Plus size={14} /> {t(ReservationsKeys.LOCKS_ADD_LOCK)}
					</button>
				</div>
			</div>

			<div className="space-y-2">
				{(locks ?? []).map((lock) => (
					<div
						key={lock._id}
						className="flex items-center justify-between gap-4 rounded-lg px-4 py-3 text-sm bg-muted border border-border"
						
					>
						<div className="flex items-center gap-3 min-w-0 text-faint-foreground">
							<Lock size={14}  />
							<span className="text-foreground" >{tableLabelFor(lock.tableId)}</span>
							<span className="text-xs text-faint-foreground" >
								{formatReservationTime(lock.startsAt, i18n.language)} →{" "}
								{formatReservationTime(lock.endsAt, i18n.language)}
							</span>
							{lock.reason && (
								<span className="text-xs text-muted-foreground" >
									· {lock.reason}
								</span>
							)}
						</div>
						<button
							type="button"
							onClick={() => handleRemove(lock._id)}
							className="p-2 rounded-md text-destructive"
							aria-label={t(ReservationsKeys.ARIA_REMOVE_LOCK)}
						>
							<Trash2 size={14}  />
						</button>
					</div>
				))}
				{(locks ?? []).length === 0 && (
					<p className="text-sm text-faint-foreground" >
						{t(ReservationsKeys.LOCKS_EMPTY)}
					</p>
				)}
			</div>
		</div>
	);
}
