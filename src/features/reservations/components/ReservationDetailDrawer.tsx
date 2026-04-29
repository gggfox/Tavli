/**
 * Drawer shown when staff click a reservation row. Shows full
 * details, lifecycle action buttons (confirm / cancel / mark seated /
 * mark completed), and the table picker on confirm.
 */
import {
	DialogHeader,
	Drawer,
	StatusBadge,
	Surface,
	getStatusToneStyle,
	toneByValue,
} from "@/global/components";
import { ReservationsKeys } from "@/global/i18n";
import type { Doc, Id } from "convex/_generated/dataModel";
import {
	CheckCircle2,
	Clock,
	Mail,
	Phone,
	UserRound,
	Users,
	UtensilsCrossed,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
	getReservationStatusConfig,
	RESERVATION_FALLBACK_TONE,
	RESERVATION_STATUS_CONFIG,
	type ReservationStatus,
} from "../statusConfig";
import { formatReservationTime } from "../utils";
import { TablePickerForReservation } from "./TablePickerForReservation";

interface ReservationDetailDrawerProps {
	reservation: Doc<"reservations"> | null;
	onClose: () => void;
	onConfirm: (reservationId: Id<"reservations">, tableIds: Id<"tables">[]) => Promise<void>;
	onCancel: (reservationId: Id<"reservations">, reason?: string) => Promise<void>;
	onMarkSeated: (reservationId: Id<"reservations">, tableId?: Id<"tables">) => Promise<void>;
	onMarkCompleted: (reservationId: Id<"reservations">) => Promise<void>;
}

export function ReservationDetailDrawer({
	reservation,
	onClose,
	onConfirm,
	onCancel,
	onMarkSeated,
	onMarkCompleted,
}: Readonly<ReservationDetailDrawerProps>) {
	const { t, i18n } = useTranslation();
	const [pickedTables, setPickedTables] = useState<Id<"tables">[]>([]);
	const [cancelReason, setCancelReason] = useState("");
	const [showCancel, setShowCancel] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const reset = () => {
		setPickedTables([]);
		setCancelReason("");
		setShowCancel(false);
		setBusy(false);
		setError(null);
	};

	const handleClose = () => {
		reset();
		onClose();
	};

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
		toneByValue(RESERVATION_STATUS_CONFIG, reservation.status as ReservationStatus) ??
		RESERVATION_FALLBACK_TONE;
	const palette = getStatusToneStyle(tone);
	const config = getReservationStatusConfig(reservation.status);
	const statusLabel = config ? t(config.labelKey) : reservation.status;

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
						<h2
							className="text-lg font-semibold text-foreground"
							
						>
							{reservation.contact.name}
						</h2>
					</div>
				}
				subtitle={
					<span
						className="text-xs font-mono break-all text-faint-foreground"
						
					>
						#{reservation._id}
					</span>
				}
				onClose={handleClose}
				closeAriaLabel={t(ReservationsKeys.ARIA_DETAIL_DRAWER_CLOSE)}
			/>

			<div
				className="px-6 py-4 space-y-3 text-sm flex-1 overflow-y-auto text-foreground"
				
			>
				<div className="flex items-center gap-2 text-faint-foreground">
					<Clock size={14}  />
					<span>{formatReservationTime(reservation.startsAt, i18n.language)}</span>
					<span className="text-faint-foreground" >
						→ {formatReservationTime(reservation.endsAt, i18n.language)}
					</span>
				</div>
				<div className="flex items-center gap-2 text-faint-foreground">
					<Users size={14}  />
					<span>
						{t(ReservationsKeys.DRAWER_PARTY_OF, { count: reservation.partySize })}
					</span>
				</div>
				<div className="flex items-center gap-2 text-faint-foreground">
					<Phone size={14}  />
					<span>{reservation.contact.phone}</span>
				</div>
				{reservation.contact.email && (
					<div className="flex items-center gap-2 text-faint-foreground">
						<Mail size={14}  />
						<span>{reservation.contact.email}</span>
					</div>
				)}
				<div className="flex items-center gap-2 text-faint-foreground">
					<UserRound size={14}  />
					<span className="text-muted-foreground" >
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
				{reservation.tableIds.length > 0 && (
					<div className="text-xs text-muted-foreground" >
						{t(ReservationsKeys.DRAWER_ASSIGNED_TABLES, {
							count: reservation.tableIds.length,
						})}
					</div>
				)}

				{reservation.status === "pending" && (
					<div
						className="pt-4 mt-2 space-y-3 border-t border-border"
						
					>
						<p className="text-sm font-medium text-foreground" >
							{t(ReservationsKeys.DRAWER_ASSIGN_TABLES_PROMPT)}
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
					<div
						className="pt-4 mt-2 space-y-2 border-t border-border"
						
					>
						<label
							htmlFor="cancel-reason"
							className="text-xs text-muted-foreground"
							
						>
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

			{error && (
				<div className="px-6 py-2 text-sm text-destructive" >
					{error}
				</div>
			)}

			<div
				className="px-6 py-4 flex flex-wrap gap-2 justify-end shrink-0 border-t border-border"
				
			>
				{reservation.status === "pending" && (
					<button
						type="button"
						disabled={busy || pickedTables.length === 0}
						onClick={() => wrap(() => onConfirm(reservation._id, pickedTables))}
						className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
						style={{opacity: pickedTables.length === 0 ? 0.6 : 1}}
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
				{(reservation.status === "pending" || reservation.status === "confirmed") &&
					(showCancel ? (
						<>
							<button
								type="button"
								disabled={busy}
								onClick={() =>
									wrap(() => onCancel(reservation._id, cancelReason || undefined))
								}
								className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium bg-destructive"
								style={{color: "white"}}
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
