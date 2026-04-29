/**
 * Drawer shown when staff click a reservation row. Shows full
 * details, lifecycle action buttons (confirm / cancel / mark seated /
 * mark completed), and the table picker on confirm.
 */
import { DialogHeader, Drawer, StatusBadge, Surface, getStatusToneStyle, toneByValue } from "@/global/components";
import type { StatusFilterOption, StatusTone } from "@/global/components";
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

type ReservationStatus =
	| "pending"
	| "confirmed"
	| "seated"
	| "completed"
	| "cancelled"
	| "no_show";

const STATUS_CHIPS: ReadonlyArray<StatusFilterOption<ReservationStatus>> = [
	{ value: "pending", label: "Pending", tone: "warning" },
	{ value: "confirmed", label: "Confirmed", tone: "info" },
	{ value: "seated", label: "Seated", tone: "success" },
	{ value: "completed", label: "Completed", tone: "neutral" },
	{ value: "cancelled", label: "Cancelled", tone: "danger" },
	{ value: "no_show", label: "No show", tone: "warning" },
];

const FALLBACK_TONE: StatusTone = "neutral";

export function ReservationDetailDrawer({
	reservation,
	onClose,
	onConfirm,
	onCancel,
	onMarkSeated,
	onMarkCompleted,
}: Readonly<ReservationDetailDrawerProps>) {
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
			setError(err instanceof Error ? err.message : "Action failed");
			setBusy(false);
		}
	};

	const isOpen = reservation !== null;

	if (!reservation) {
		return <Drawer isOpen={false} onClose={handleClose} ariaLabel="Reservation details" />;
	}

	const tone =
		toneByValue(STATUS_CHIPS, reservation.status as ReservationStatus) ?? FALLBACK_TONE;
	const palette = getStatusToneStyle(tone);
	const statusLabel =
		STATUS_CHIPS.find((c) => c.value === reservation.status)?.label ?? reservation.status;

	return (
		<Drawer
			isOpen={isOpen}
			onClose={handleClose}
			ariaLabel="Reservation details"
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
							className="text-lg font-semibold"
							style={{ color: "var(--text-primary)" }}
						>
							{reservation.contact.name}
						</h2>
					</div>
				}
				subtitle={
					<span
						className="text-xs font-mono break-all"
						style={{ color: "var(--text-muted)" }}
					>
						#{reservation._id}
					</span>
				}
				onClose={handleClose}
				closeAriaLabel="Close drawer"
			/>

			<div
				className="px-6 py-4 space-y-3 text-sm flex-1 overflow-y-auto"
				style={{ color: "var(--text-primary)" }}
			>
				<div className="flex items-center gap-2">
					<Clock size={14} style={{ color: "var(--text-muted)" }} />
					<span>{formatReservationTime(reservation.startsAt)}</span>
					<span style={{ color: "var(--text-muted)" }}>
						→ {formatReservationTime(reservation.endsAt)}
					</span>
				</div>
				<div className="flex items-center gap-2">
					<Users size={14} style={{ color: "var(--text-muted)" }} />
					<span>Party of {reservation.partySize}</span>
				</div>
				<div className="flex items-center gap-2">
					<Phone size={14} style={{ color: "var(--text-muted)" }} />
					<span>{reservation.contact.phone}</span>
				</div>
				{reservation.contact.email && (
					<div className="flex items-center gap-2">
						<Mail size={14} style={{ color: "var(--text-muted)" }} />
						<span>{reservation.contact.email}</span>
					</div>
				)}
				<div className="flex items-center gap-2">
					<UserRound size={14} style={{ color: "var(--text-muted)" }} />
					<span style={{ color: "var(--text-secondary)" }}>via {reservation.source}</span>
				</div>
				{reservation.notes && (
					<Surface
						tone="secondary"
						bordered={false}
						rounded="md"
						className="p-3 text-xs"
						style={{ color: "var(--text-secondary)" }}
					>
						{reservation.notes}
					</Surface>
				)}
				{reservation.tableIds.length > 0 && (
					<div className="text-xs" style={{ color: "var(--text-secondary)" }}>
						Assigned: {reservation.tableIds.length}{" "}
						{reservation.tableIds.length === 1 ? "table" : "tables"}
					</div>
				)}

				{reservation.status === "pending" && (
					<div
						className="pt-4 mt-2 space-y-3"
						style={{ borderTop: "1px solid var(--border-default)" }}
					>
						<p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
							Assign tables to confirm
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
						className="pt-4 mt-2 space-y-2"
						style={{ borderTop: "1px solid var(--border-default)" }}
					>
						<label
							htmlFor="cancel-reason"
							className="text-xs"
							style={{ color: "var(--text-secondary)" }}
						>
							Cancellation reason (optional)
						</label>
						<input
							id="cancel-reason"
							type="text"
							value={cancelReason}
							onChange={(e) => setCancelReason(e.target.value)}
							className="w-full rounded-md px-3 py-2 text-sm"
							style={{
								backgroundColor: "var(--bg-secondary)",
								border: "1px solid var(--border-default)",
								color: "var(--text-primary)",
							}}
						/>
					</div>
				)}
			</div>

			{error && (
				<div className="px-6 py-2 text-sm" style={{ color: "var(--accent-danger)" }}>
					{error}
				</div>
			)}

			<div
				className="px-6 py-4 flex flex-wrap gap-2 justify-end shrink-0"
				style={{ borderTop: "1px solid var(--border-default)" }}
			>
				{reservation.status === "pending" && (
					<button
						type="button"
						disabled={busy || pickedTables.length === 0}
						onClick={() => wrap(() => onConfirm(reservation._id, pickedTables))}
						className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
						style={{ opacity: pickedTables.length === 0 ? 0.6 : 1 }}
					>
						<CheckCircle2 size={14} />
						Confirm
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
						Mark seated
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
						Mark completed
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
								className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium"
								style={{ backgroundColor: "var(--accent-danger)", color: "white" }}
							>
								<XCircle size={14} />
								Confirm cancel
							</button>
							<button
								type="button"
								onClick={() => setShowCancel(false)}
								className="px-4 py-2 rounded-lg text-sm"
								style={{
									border: "1px solid var(--border-default)",
									color: "var(--text-secondary)",
								}}
							>
								Back
							</button>
						</>
					) : (
						<button
							type="button"
							onClick={() => setShowCancel(true)}
							className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm"
							style={{
								border: "1px solid var(--border-default)",
								color: "var(--accent-danger)",
							}}
						>
							<XCircle size={14} />
							Cancel
						</button>
					))}
			</div>
		</Drawer>
	);
}
