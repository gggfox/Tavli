import { CopyableId, StatusBadge, Surface } from "@/global/components";
import { DisputesKeys } from "@/global/i18n";
import { formatDate } from "@/global/utils/date";
import { DISPUTE_STATUS, type DisputeRecoveryStatus, type DisputeStatus } from "convex/constants";
import { useTranslation } from "react-i18next";
import {
	DISPUTE_STATUS_BADGE,
	DISPUTE_STATUS_ICON,
	DISPUTE_STATUS_LABEL_KEY,
	formatDisputeMoney,
} from "../constants";

export interface DisputeRowData {
	readonly stripeDisputeId: string;
	readonly status: DisputeStatus;
	readonly reason: string;
	readonly amount: number;
	readonly currency: string;
	readonly openedAt: number | undefined;
	readonly closedAt: number | undefined;
	readonly reinstatedAt: number | undefined;
	readonly dailyOrderNumber: number | null;
	readonly outstanding: number;
	readonly recovered: number;
	readonly recoveryStatus: DisputeRecoveryStatus | null;
}

export interface DisputeRowProps {
	readonly dispute: DisputeRowData;
	/** The restaurant's recovery percentage; 0 when nothing is withheld. */
	readonly recoveryPercent: number;
	/** Platform admins also see the ledger line beneath a lost dispute. */
	readonly showLedger: boolean;
}

/**
 * One dispute in the list (TAVLI-102).
 *
 * Answers four questions in one row, in the order a manager asks them: **what
 * was disputed, which order, how much, and what happens next.** "What happens
 * next" is rendered inline rather than behind a disclosure for the same reason
 * the payouts page renders a failure reason inline — it is the thing the
 * manager came here for, and hiding it behind a click is hiding the answer.
 *
 * The next-step copy on a loss is chosen from the restaurant's own recovery
 * percentage, because the two cases are genuinely different promises: with
 * recovery off, Tavli absorbs it and nothing will be withheld; with it on, a
 * capped slice of later orders is held back until the amount is repaid. Saying
 * the wrong one is how a short payout arrives unexplained.
 *
 * Stripe's raw status never reaches here — the backend hands over the
 * normalized one, so there is nothing that could render as an identifier.
 */
export function DisputeRow({ dispute, recoveryPercent, showLedger }: DisputeRowProps) {
	const { t, i18n } = useTranslation();

	const isLost = dispute.status === DISPUTE_STATUS.LOST;
	const StatusIcon = DISPUTE_STATUS_ICON[dispute.status];
	const badge = DISPUTE_STATUS_BADGE[dispute.status];
	const locale = i18n.language?.startsWith("es") ? "es-MX" : "en-US";

	const dateLine = (() => {
		if (dispute.reinstatedAt) {
			return t(DisputesKeys.LIST_REINSTATED_ON, {
				date: formatDate(dispute.reinstatedAt, locale),
			});
		}
		if (dispute.closedAt) {
			return t(DisputesKeys.LIST_CLOSED_ON, { date: formatDate(dispute.closedAt, locale) });
		}
		if (dispute.openedAt) {
			return t(DisputesKeys.LIST_OPENED_ON, { date: formatDate(dispute.openedAt, locale) });
		}
		return null;
	})();

	const nextKey = (() => {
		if (!isLost) {
			return dispute.status === DISPUTE_STATUS.WON ||
				dispute.status === DISPUTE_STATUS.WARNING_CLOSED
				? DisputesKeys.NEXT_WON
				: DisputesKeys.NEXT_OPEN;
		}
		if (recoveryPercent <= 0) return DisputesKeys.NEXT_LOST_NO_RECOVERY;
		// Repaid in full (or written off): there is nothing left to withhold, so
		// promising further deductions would be wrong.
		if (dispute.outstanding <= 0) return DisputesKeys.NEXT_LOST_SETTLED;
		return DisputesKeys.NEXT_LOST_WITH_RECOVERY;
	})();

	return (
		<Surface
			tone="secondary"
			rounded="lg"
			className="p-4 space-y-3"
			data-testid={`dispute-row-${dispute.stripeDisputeId}`}
		>
			<div className="flex items-start justify-between gap-4">
				<div className="flex items-start gap-3 min-w-0">
					<span
						className={
							isLost ? "text-destructive mt-0.5 shrink-0" : "text-faint-foreground mt-0.5 shrink-0"
						}
					>
						<StatusIcon size={18} />
					</span>
					<div className="min-w-0">
						<p className="text-base font-semibold text-foreground">
							{formatDisputeMoney(dispute.amount, dispute.currency)}
						</p>
						<p className="text-xs text-faint-foreground">
							{dispute.dailyOrderNumber === null
								? t(DisputesKeys.LIST_ORDER_UNKNOWN)
								: t(DisputesKeys.LIST_ORDER, { number: dispute.dailyOrderNumber })}
						</p>
						{dateLine && <p className="text-xs text-faint-foreground">{dateLine}</p>}
					</div>
				</div>

				<StatusBadge
					bgColor={badge.bgColor}
					textColor={badge.textColor}
					label={t(DISPUTE_STATUS_LABEL_KEY[dispute.status])}
				/>
			</div>

			<div className="space-y-2 pl-8">
				<div>
					<p className="text-xs font-semibold uppercase tracking-wide text-faint-foreground">
						{t(DisputesKeys.LIST_NEXT_LABEL)}
					</p>
					<p className="text-sm text-foreground">
						{t(nextKey, {
							percent: recoveryPercent,
							outstanding: formatDisputeMoney(dispute.outstanding, dispute.currency),
						})}
					</p>
				</div>

				{/*
				 * The ledger line is admin-only: a manager needs "we are repaying
				 * this and how much is left", which the next-step line above
				 * already says. The row-level split between recovered and
				 * outstanding is Tavli's own bookkeeping.
				 */}
				{showLedger && dispute.recoveryStatus !== null && (
					<div data-testid={`dispute-ledger-${dispute.stripeDisputeId}`}>
						<p className="text-xs font-semibold uppercase tracking-wide text-faint-foreground">
							{t(DisputesKeys.LIST_LEDGER_LABEL)}
						</p>
						<p className="text-sm text-foreground">
							{t(DisputesKeys.LIST_LEDGER_LINE, {
								recovered: formatDisputeMoney(dispute.recovered, dispute.currency),
								outstanding: formatDisputeMoney(dispute.outstanding, dispute.currency),
								status: dispute.recoveryStatus,
							})}
						</p>
					</div>
				)}

				<div className="flex items-center gap-2 text-xs text-faint-foreground">
					<span>{t(DisputesKeys.LIST_REFERENCE)}</span>
					<CopyableId id={dispute.stripeDisputeId} />
				</div>
			</div>
		</Surface>
	);
}
