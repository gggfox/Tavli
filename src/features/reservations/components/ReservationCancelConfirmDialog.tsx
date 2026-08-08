/**
 * Confirmation step for cancelling a reservation that already happened.
 *
 * A `completed` reservation still holds its table window, so cancelling one is
 * a correction ("we marked the wrong booking completed") rather than a routine
 * lifecycle move — it gets an explicit modal instead of the inline reason
 * field the pending / confirmed flow uses.
 */
import { Modal } from "@/global/components";
import { ReservationsKeys } from "@/global/i18n";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ReservationCancelConfirmDialogProps {
	readonly isOpen: boolean;
	readonly guestName: string;
	readonly reason: string;
	readonly busy: boolean;
	/** Surfaced here as well as in the drawer, which the modal covers. */
	readonly error: string | null;
	readonly onReasonChange: (next: string) => void;
	readonly onClose: () => void;
	readonly onConfirm: () => void;
}

export function ReservationCancelConfirmDialog({
	isOpen,
	guestName,
	reason,
	busy,
	error,
	onReasonChange,
	onClose,
	onConfirm,
}: Readonly<ReservationCancelConfirmDialogProps>) {
	const { t } = useTranslation();

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			ariaLabel={t(ReservationsKeys.DRAWER_CANCEL_COMPLETED_TITLE)}
			size="sm"
		>
			<div className="rounded-xl p-6 bg-background border border-border">
				<div className="flex items-center justify-between mb-4">
					<h2 className="text-lg font-semibold text-foreground">
						{t(ReservationsKeys.DRAWER_CANCEL_COMPLETED_TITLE)}
					</h2>
					<button
						type="button"
						onClick={onClose}
						disabled={busy}
						className="p-1 rounded-md transition-colors hover:opacity-80 text-faint-foreground"
					>
						<X size={18} />
					</button>
				</div>

				<p className="text-sm text-muted-foreground mb-4">
					{t(ReservationsKeys.DRAWER_CANCEL_COMPLETED_BODY, { guest: guestName })}
				</p>

				<div className="space-y-2 mb-4">
					<label htmlFor="cancel-completed-reason" className="block text-xs text-muted-foreground">
						{t(ReservationsKeys.DRAWER_CANCEL_REASON_LABEL)}
					</label>
					<input
						id="cancel-completed-reason"
						type="text"
						value={reason}
						onChange={(e) => onReasonChange(e.target.value)}
						disabled={busy}
						className="w-full rounded-md px-3 py-2 text-sm bg-muted border border-border text-foreground"
					/>
				</div>

				{error && <p className="text-sm mb-3 text-destructive">{error}</p>}

				<div className="flex justify-end gap-3">
					<button
						type="button"
						onClick={onClose}
						disabled={busy}
						className="px-4 py-2 rounded-lg text-sm transition-colors bg-muted text-foreground border border-border"
					>
						{t(ReservationsKeys.ACTION_BACK)}
					</button>
					<button
						type="button"
						onClick={onConfirm}
						disabled={busy}
						className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium bg-destructive disabled:opacity-50"
						style={{ color: "white" }}
					>
						{busy ? t(ReservationsKeys.FORM_SUBMITTING) : t(ReservationsKeys.ACTION_CONFIRM_CANCEL)}
					</button>
				</div>
			</div>
		</Modal>
	);
}
