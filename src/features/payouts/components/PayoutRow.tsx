import { CopyableId, StatusBadge, Surface } from "@/global/components";
import { PayoutsKeys } from "@/global/i18n";
import { formatDate } from "@/global/utils/date";
import {
	PAYOUT_FAILURE_FIX_KEY,
	PAYOUT_FAILURE_REASON_KEY,
	STRIPE_PAYOUT_STATUS,
	type PayoutFailureCode,
	type StripePayoutStatus,
} from "convex/constants";
import { useTranslation } from "react-i18next";
import {
	formatPayoutMoney,
	PAYOUT_STATUS_BADGE,
	PAYOUT_STATUS_ICON,
	PAYOUT_STATUS_LABEL_KEY,
} from "../constants";

export interface PayoutRowData {
	readonly stripePayoutId: string;
	readonly amount: number;
	readonly currency: string;
	readonly status: StripePayoutStatus;
	readonly createdAt: number;
	readonly arrivalDate: number | undefined;
	readonly failureCode: PayoutFailureCode | undefined;
}

/**
 * One payout in the list (TAVLI-103).
 *
 * A failed row carries the reason and the fix inline rather than behind a
 * disclosure: the reason is the only thing the manager came here for, and
 * hiding it behind a click would be hiding the answer. Every other status is one
 * line — a payout that arrived needs no explanation.
 *
 * The reason and the fix are rendered from the **normalized** `failureCode` via
 * `PAYOUT_FAILURE_REASON_KEY` / `PAYOUT_FAILURE_FIX_KEY`. The backend never
 * sends Stripe's raw `failure_message`, so there is nothing here that could
 * accidentally render it.
 */
export function PayoutRow({ payout }: { readonly payout: PayoutRowData }) {
	const { t, i18n } = useTranslation();

	const isFailed = payout.status === STRIPE_PAYOUT_STATUS.FAILED;
	const StatusIcon = PAYOUT_STATUS_ICON[payout.status];
	const badge = PAYOUT_STATUS_BADGE[payout.status];
	const locale = i18n.language?.startsWith("es") ? "es-MX" : "en-US";

	const arrivalLine = (() => {
		if (!payout.arrivalDate) return null;
		const key =
			payout.status === STRIPE_PAYOUT_STATUS.PAID
				? PayoutsKeys.LIST_ARRIVED_ON
				: PayoutsKeys.LIST_ARRIVES_ON;
		// A failed payout never arrived and never will: Stripe replaces it with a
		// new one, so showing it an expected date would be a promise nobody made.
		if (isFailed || payout.status === STRIPE_PAYOUT_STATUS.CANCELED) return null;
		return t(key, { date: formatDate(payout.arrivalDate, locale) });
	})();

	return (
		<Surface
			tone="secondary"
			rounded="lg"
			className="p-4 space-y-3"
			data-testid={`payout-row-${payout.stripePayoutId}`}
		>
			<div className="flex items-start justify-between gap-4">
				<div className="flex items-start gap-3 min-w-0">
					<span
						className={
							isFailed
								? "text-destructive mt-0.5 shrink-0"
								: "text-faint-foreground mt-0.5 shrink-0"
						}
					>
						<StatusIcon size={18} />
					</span>
					<div className="min-w-0">
						<p className="text-base font-semibold text-foreground">
							{formatPayoutMoney(payout.amount, payout.currency)}
						</p>
						<p className="text-xs text-faint-foreground">
							{t(PayoutsKeys.LIST_SENT_ON, { date: formatDate(payout.createdAt, locale) })}
						</p>
						{arrivalLine && <p className="text-xs text-faint-foreground">{arrivalLine}</p>}
					</div>
				</div>

				<StatusBadge
					bgColor={badge.bgColor}
					textColor={badge.textColor}
					label={t(PAYOUT_STATUS_LABEL_KEY[payout.status])}
				/>
			</div>

			{isFailed && (
				<div className="space-y-2 pl-8">
					<div>
						<p className="text-xs font-semibold uppercase tracking-wide text-faint-foreground">
							{t(PayoutsKeys.LIST_REASON_LABEL)}
						</p>
						<p className="text-sm text-foreground">
							{t(PAYOUT_FAILURE_REASON_KEY[payout.failureCode ?? "unknown"])}
						</p>
					</div>
					<div>
						<p className="text-xs font-semibold uppercase tracking-wide text-faint-foreground">
							{t(PayoutsKeys.LIST_FIX_LABEL)}
						</p>
						<p className="text-sm text-foreground">
							{t(PAYOUT_FAILURE_FIX_KEY[payout.failureCode ?? "unknown"])}
						</p>
					</div>
					<div className="flex items-center gap-2 text-xs text-faint-foreground">
						<span>{t(PayoutsKeys.LIST_REFERENCE)}</span>
						<CopyableId id={payout.stripePayoutId} />
					</div>
				</div>
			)}
		</Surface>
	);
}
