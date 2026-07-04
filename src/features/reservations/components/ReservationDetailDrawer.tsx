/**
 * Drawer shown when staff click a reservation row. Shows full
 * details, editable time/tables for active bookings, lifecycle
 * action buttons (confirm / cancel / mark seated / mark completed).
 */
import {
	DialogHeader,
	Drawer,
	getStatusToneStyle,
	StatusBadge,
	Surface,
	toneByValue,
} from "@/global/components";
import { ReservationsKeys } from "@/global/i18n";
import type { Doc, Id } from "convex/_generated/dataModel";
import {
	CheckCircle2,
	Mail,
	Phone,
	Save,
	UserRound,
	Users,
	UtensilsCrossed,
	XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	getReservationStatusConfig,
	RESERVATION_FALLBACK_TONE,
	RESERVATION_STATUS_CONFIG,
} from "../statusConfig";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "../utils";
import type { TimelineRescheduleIntent } from "./ReservationTimeline";
import { TablePickerForReservation } from "./TablePickerForReservation";

const MIN_DURATION_MS = 15 * 60_000;

const ERROR_TO_KEY: Record<string, string> = {
	ERROR_OUTSIDE_BOOKING_HORIZON: ReservationsKeys.REASON_OUTSIDE_BOOKING_HORIZON,
	ERROR_BLACKOUT_WINDOW: ReservationsKeys.REASON_BLACKOUT_WINDOW,
	ERROR_TABLE_UNAVAILABLE: ReservationsKeys.REASON_NO_TABLES,
};

function mapRescheduleError(message: string, t: (key: string) => string): string {
	const key = ERROR_TO_KEY[message];
	return key ? t(key) : message;
}

function tableIdsEqual(a: Id<"tables">[], b: Id<"tables">[]): boolean {
	if (a.length !== b.length) return false;
	const sortedA = [...a].sort((x, y) => x.localeCompare(y));
	const sortedB = [...b].sort((x, y) => x.localeCompare(y));
	return sortedA.every((id, i) => id === sortedB[i]);
}

interface ReservationDetailDrawerProps {
	reservation: Doc<"reservations"> | null;
	onClose: () => void;
	onConfirm: (reservationId: Id<"reservations">, tableIds: Id<"tables">[]) => Promise<void>;
	onReconfirm: (reservationId: Id<"reservations">, tableIds?: Id<"tables">[]) => Promise<void>;
	onCancel: (reservationId: Id<"reservations">, reason?: string) => Promise<void>;
	onMarkSeated: (reservationId: Id<"reservations">, tableId?: Id<"tables">) => Promise<void>;
	onMarkCompleted: (reservationId: Id<"reservations">) => Promise<void>;
	onReschedule: (intent: TimelineRescheduleIntent) => Promise<void>;
}

export function ReservationDetailDrawer({
	reservation,
	onClose,
	onConfirm,
	onReconfirm,
	onCancel,
	onMarkSeated,
	onMarkCompleted,
	onReschedule,
}: Readonly<ReservationDetailDrawerProps>) {
	const { t } = useTranslation();
	const [pickedTables, setPickedTables] = useState<Id<"tables">[]>([]);
	const [editStart, setEditStart] = useState("");
	const [editEnd, setEditEnd] = useState("");
	const [editTables, setEditTables] = useState<Id<"tables">[]>([]);
	const [cancelReason, setCancelReason] = useState("");
	const [showCancel, setShowCancel] = useState(false);
	const [busy, setBusy] = useState(false);
	const [saveBusy, setSaveBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saveSuccess, setSaveSuccess] = useState(false);

	const reset = () => {
		setPickedTables([]);
		setEditStart("");
		setEditEnd("");
		setEditTables([]);
		setCancelReason("");
		setShowCancel(false);
		setBusy(false);
		setSaveBusy(false);
		setError(null);
		setSaveSuccess(false);
	};

	const handleClose = () => {
		reset();
		onClose();
	};

	useEffect(() => {
		if (!reservation) return;
		setEditStart(toDateTimeLocalValue(reservation.startsAt));
		setEditEnd(toDateTimeLocalValue(reservation.endsAt));
		setEditTables(reservation.tableIds);
		setSaveSuccess(false);
		setError(null);
	}, [reservation]);

	const wrap = async (fn: () => Promise<void>) => {
		setBusy(true);
		setError(null);
		try {
			await fn();
			reset();
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : t(ReservationsKeys.ERROR_ACTION_FAILED));
			setBusy(false);
		}
	};

	const isOpen = reservation !== null;

	const isEditable =
		reservation?.status === "pending" ||
		reservation?.status === "confirmed" ||
		reservation?.status === "seated";

	const editDirty = useMemo(() => {
		if (!reservation || !isEditable) return false;
		const parsedStart = fromDateTimeLocalValue(editStart);
		const parsedEnd = fromDateTimeLocalValue(editEnd);
		if (Number.isNaN(parsedStart) || Number.isNaN(parsedEnd)) return false;
		const timeChanged = parsedStart !== reservation.startsAt || parsedEnd !== reservation.endsAt;
		const tablesChanged = !tableIdsEqual(editTables, reservation.tableIds);
		return timeChanged || tablesChanged;
	}, [reservation, isEditable, editStart, editEnd, editTables]);

	const handleSave = async () => {
		if (!reservation || !editDirty) return;

		const parsedStartsAt = fromDateTimeLocalValue(editStart);
		const parsedEndsAt = fromDateTimeLocalValue(editEnd);
		if (Number.isNaN(parsedStartsAt) || Number.isNaN(parsedEndsAt)) {
			setError(t(ReservationsKeys.ERROR_ACTION_FAILED));
			return;
		}
		if (parsedEndsAt <= parsedStartsAt) {
			setError(t(ReservationsKeys.DRAWER_EDIT_END_BEFORE_START));
			return;
		}
		if (parsedEndsAt - parsedStartsAt < MIN_DURATION_MS) {
			setError(t(ReservationsKeys.DRAWER_EDIT_MIN_DURATION));
			return;
		}
		if (reservation.status === "seated" && editTables.length === 0) {
			setError(t(ReservationsKeys.DRAWER_EDIT_SEATED_NEEDS_TABLE));
			return;
		}

		const timeChanged =
			parsedStartsAt !== reservation.startsAt || parsedEndsAt !== reservation.endsAt;
		const tablesChanged = !tableIdsEqual(editTables, reservation.tableIds);

		setSaveBusy(true);
		setError(null);
		setSaveSuccess(false);
		try {
			await onReschedule({
				reservationId: reservation._id,
				...(timeChanged
					? {
							startsAt: parsedStartsAt,
							endsAt: parsedEndsAt,
						}
					: {}),
				...(tablesChanged ? { tableIds: editTables } : {}),
			});
			setSaveSuccess(true);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "";
			setError(mapRescheduleError(msg, t) || t(ReservationsKeys.ERROR_ACTION_FAILED));
		} finally {
			setSaveBusy(false);
		}
	};

	if (!reservation) {
		return (
			<Drawer
				isOpen={false}
				onClose={handleClose}
				ariaLabel={t(ReservationsKeys.ARIA_DETAIL_DRAWER)}
			>
				{null}
			</Drawer>
		);
	}

	const tone =
		toneByValue(RESERVATION_STATUS_CONFIG, reservation.status) ?? RESERVATION_FALLBACK_TONE;
	const palette = getStatusToneStyle(tone);
	const config = getReservationStatusConfig(reservation.status);
	const statusLabel = config ? t(config.labelKey) : reservation.status;
	const isTerminalRecoverable =
		reservation.status === "cancelled" || reservation.status === "no_show";
	const needsTablesToReconfirm = isTerminalRecoverable && reservation.tableIds.length === 0;

	const parsedEditStart = fromDateTimeLocalValue(editStart);
	const parsedEditEnd = fromDateTimeLocalValue(editEnd);
	const pickerStartsAt = Number.isNaN(parsedEditStart) ? reservation.startsAt : parsedEditStart;
	const pickerEndsAt = Number.isNaN(parsedEditEnd) ? reservation.endsAt : parsedEditEnd;

	return (
		<Drawer
			isOpen={isOpen}
			onClose={handleClose}
			ariaLabel={t(ReservationsKeys.ARIA_DETAIL_DRAWER)}
			side="right"
		>
			<DialogHeader
				title={
					<div className="flex items-center gap-2 flex-wrap">
						<StatusBadge
							bgColor={palette.solidBg}
							textColor={palette.solidFg}
							label={statusLabel}
						/>
						<h2 className="text-lg font-semibold text-foreground">{reservation.contact.name}</h2>
					</div>
				}
				subtitle={
					<span className="text-xs font-mono break-all text-faint-foreground">
						#{reservation._id}
					</span>
				}
				onClose={handleClose}
				closeAriaLabel={t(ReservationsKeys.ARIA_DETAIL_DRAWER_CLOSE)}
			/>

			<div className="px-6 py-4 space-y-3 text-sm flex-1 overflow-y-auto text-foreground">
				{isEditable ? (
					<div className="space-y-3 pb-3 border-b border-border">
						<p className="text-sm font-medium text-foreground">
							{t(ReservationsKeys.DRAWER_EDIT_SECTION_TITLE)}
						</p>
						<div className="grid grid-cols-2 gap-3">
							<div>
								<label
									htmlFor="edit-start"
									className="block text-xs font-medium mb-1 text-muted-foreground"
								>
									{t(ReservationsKeys.DRAWER_EDIT_START)}
								</label>
								<input
									id="edit-start"
									type="datetime-local"
									value={editStart}
									onChange={(e) => setEditStart(e.target.value)}
									className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
								/>
							</div>
							<div>
								<label
									htmlFor="edit-end"
									className="block text-xs font-medium mb-1 text-muted-foreground"
								>
									{t(ReservationsKeys.DRAWER_EDIT_END)}
								</label>
								<input
									id="edit-end"
									type="datetime-local"
									value={editEnd}
									onChange={(e) => setEditEnd(e.target.value)}
									className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
								/>
							</div>
						</div>
						<div>
							<p className="text-xs font-medium mb-2 text-muted-foreground">
								{t(ReservationsKeys.DRAWER_EDIT_TABLES_PROMPT)}
							</p>
							<TablePickerForReservation
								restaurantId={reservation.restaurantId}
								startsAt={pickerStartsAt}
								endsAt={pickerEndsAt}
								partySize={reservation.partySize}
								excludeReservationId={reservation._id}
								value={editTables}
								onChange={setEditTables}
							/>
						</div>
						<button
							type="button"
							disabled={saveBusy || !editDirty}
							onClick={() => void handleSave()}
							className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
							style={{ opacity: editDirty ? 1 : 0.6 }}
						>
							<Save size={14} />
							{saveBusy
								? t(ReservationsKeys.DRAWER_EDIT_SAVING)
								: t(ReservationsKeys.DRAWER_EDIT_SAVE)}
						</button>
						{saveSuccess && (
							<p className="text-xs text-muted-foreground">
								{t(ReservationsKeys.DRAWER_EDIT_SUCCESS)}
							</p>
						)}
					</div>
				) : (
					reservation.tableIds.length > 0 && (
						<div className="text-xs text-muted-foreground">
							{t(ReservationsKeys.DRAWER_ASSIGNED_TABLES, {
								count: reservation.tableIds.length,
							})}
						</div>
					)
				)}

				<div className="flex items-center gap-2 text-faint-foreground">
					<Users size={14} />
					<span>{t(ReservationsKeys.DRAWER_PARTY_OF, { count: reservation.partySize })}</span>
				</div>
				<div className="flex items-center gap-2 text-faint-foreground">
					<Phone size={14} />
					<span>{reservation.contact.phone}</span>
				</div>
				{reservation.contact.email && (
					<div className="flex items-center gap-2 text-faint-foreground">
						<Mail size={14} />
						<span>{reservation.contact.email}</span>
					</div>
				)}
				<div className="flex items-center gap-2 text-faint-foreground">
					<UserRound size={14} />
					<span className="text-muted-foreground">
						{t(ReservationsKeys.DRAWER_VIA, { source: reservation.source })}
					</span>
				</div>
				{reservation.notes && (
					<Surface
						tone="secondary"
						bordered={false}
						rounded="md"
						className="p-3 text-xs text-muted-foreground"
					>
						{reservation.notes}
					</Surface>
				)}

				{needsTablesToReconfirm && (
					<div className="pt-4 mt-2 space-y-3 border-t border-border">
						<p className="text-sm font-medium text-foreground">
							{t(ReservationsKeys.DRAWER_RECONFIRM_ASSIGN_TABLES_PROMPT)}
						</p>
						<TablePickerForReservation
							restaurantId={reservation.restaurantId}
							startsAt={reservation.startsAt}
							endsAt={reservation.endsAt}
							partySize={reservation.partySize}
							excludeReservationId={reservation._id}
							value={pickedTables}
							onChange={setPickedTables}
						/>
					</div>
				)}

				{needsTablesToReconfirm && (
					<div className="pt-4 mt-2 space-y-3 border-t border-border">
						<p className="text-sm font-medium text-foreground">
							{t(ReservationsKeys.DRAWER_RECONFIRM_ASSIGN_TABLES_PROMPT)}
						</p>
						<TablePickerForReservation
							restaurantId={reservation.restaurantId}
							startsAt={reservation.startsAt}
							endsAt={reservation.endsAt}
							partySize={reservation.partySize}
							excludeReservationId={reservation._id}
							value={pickedTables}
							onChange={setPickedTables}
						/>
					</div>
				)}

				{showCancel && (
					<div className="pt-4 mt-2 space-y-2 border-t border-border">
						<label htmlFor="cancel-reason" className="text-xs text-muted-foreground">
							{t(ReservationsKeys.DRAWER_CANCEL_REASON_LABEL)}
						</label>
						<input
							id="cancel-reason"
							type="text"
							value={cancelReason}
							onChange={(e) => setCancelReason(e.target.value)}
							className="w-full rounded-md px-3 py-2 text-sm bg-muted border border-border text-foreground"
						/>
					</div>
				)}
			</div>

			{error && <div className="px-6 py-2 text-sm text-destructive">{error}</div>}

			<div className="px-6 py-4 flex flex-wrap gap-2 justify-end shrink-0 border-t border-border">
				{reservation.status === "pending" && (
					<button
						type="button"
						disabled={busy || editTables.length === 0}
						onClick={() => wrap(() => onConfirm(reservation._id, editTables))}
						className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
						style={{ opacity: editTables.length === 0 ? 0.6 : 1 }}
					>
						<CheckCircle2 size={14} />
						{t(ReservationsKeys.ACTION_CONFIRM)}
					</button>
				)}
				{reservation.status === "confirmed" && (
					<button
						type="button"
						disabled={busy}
						onClick={() => wrap(() => onMarkSeated(reservation._id))}
						className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
					>
						<UtensilsCrossed size={14} />
						{t(ReservationsKeys.ACTION_MARK_SEATED)}
					</button>
				)}
				{reservation.status === "seated" && (
					<button
						type="button"
						disabled={busy}
						onClick={() => wrap(() => onMarkCompleted(reservation._id))}
						className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
					>
						<CheckCircle2 size={14} />
						{t(ReservationsKeys.ACTION_MARK_COMPLETED)}
					</button>
				)}
				{isTerminalRecoverable && (
					<>
						<button
							type="button"
							disabled={busy || (needsTablesToReconfirm && pickedTables.length === 0)}
							onClick={() =>
								wrap(() =>
									onReconfirm(reservation._id, needsTablesToReconfirm ? pickedTables : undefined)
								)
							}
							className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
							style={{ opacity: needsTablesToReconfirm && pickedTables.length === 0 ? 0.6 : 1 }}
						>
							<CheckCircle2 size={14} />
							{t(ReservationsKeys.ACTION_RECONFIRM)}
						</button>
						{reservation.tableIds.length > 0 && (
							<button
								type="button"
								disabled={busy}
								onClick={() => wrap(() => onMarkSeated(reservation._id))}
								className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
							>
								<UtensilsCrossed size={14} />
								{t(ReservationsKeys.ACTION_MARK_SEATED)}
							</button>
						)}
					</>
				)}
				{(reservation.status === "pending" || reservation.status === "confirmed") &&
					(showCancel ? (
						<>
							<button
								type="button"
								disabled={busy}
								onClick={() => wrap(() => onCancel(reservation._id, cancelReason || undefined))}
								className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium bg-destructive"
								style={{ color: "white" }}
							>
								<XCircle size={14} />
								{t(ReservationsKeys.ACTION_CONFIRM_CANCEL)}
							</button>
							<button
								type="button"
								onClick={() => setShowCancel(false)}
								className="px-4 py-2 rounded-lg text-sm border border-border text-muted-foreground"
							>
								{t(ReservationsKeys.ACTION_BACK)}
							</button>
						</>
					) : (
						<button
							type="button"
							onClick={() => setShowCancel(true)}
							className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm border border-border text-destructive"
						>
							<XCircle size={14} />
							{t(ReservationsKeys.ACTION_CANCEL)}
						</button>
					))}
			</div>
		</Drawer>
	);
}
