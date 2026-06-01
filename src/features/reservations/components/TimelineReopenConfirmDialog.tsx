import { Modal } from "@/global/components";
import { ReservationsKeys } from "@/global/i18n";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface TimelineReopenConfirmDialogProps {
	readonly isOpen: boolean;
	readonly guestName: string;
	readonly busy: boolean;
	readonly onClose: () => void;
	readonly onConfirm: () => void;
}

export function TimelineReopenConfirmDialog({
	isOpen,
	guestName,
	busy,
	onClose,
	onConfirm,
}: Readonly<TimelineReopenConfirmDialogProps>) {
	const { t } = useTranslation();

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			ariaLabel={t(ReservationsKeys.TIMELINE_REOPEN_CONFIRM_TITLE)}
			size="sm"
		>
			<div className="rounded-xl p-6 bg-background border border-border">
				<div className="flex items-center justify-between mb-4">
					<h2 className="text-lg font-semibold text-foreground">
						{t(ReservationsKeys.TIMELINE_REOPEN_CONFIRM_TITLE)}
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
					{t(ReservationsKeys.TIMELINE_REOPEN_CONFIRM_BODY, { guest: guestName })}
				</p>

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
						className="px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary disabled:opacity-50"
					>
						{busy
							? t(ReservationsKeys.FORM_SUBMITTING)
							: t(ReservationsKeys.TIMELINE_REOPEN_CONFIRM_BUTTON)}
					</button>
				</div>
			</div>
		</Modal>
	);
}
