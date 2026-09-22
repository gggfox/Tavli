import { Button, InlineError, Surface } from "@/global/components";
import { PayoutsKeys } from "@/global/i18n";
import type { Id } from "convex/_generated/dataModel";
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatPayoutMoney } from "../constants";
import { useUpdateBankDetails } from "../hooks/useUpdateBankDetails";

export interface HeldTotalCardProps {
	readonly restaurantId: Id<"restaurants"> | undefined;
	readonly heldCents: number;
	readonly currency: string;
	readonly failedCount: number;
}

/**
 * The card at the top of the payouts page, shown only while money is stuck
 * (TAVLI-103).
 *
 * The order of the three lines is the whole design, and it is the order the
 * ticket settled on: **"this money is yours and it is safe"**, then the amount
 * and why it has not arrived, then the one thing the manager can do about it.
 *
 * A restaurant that reads "payout failed" concludes its takings are gone. They
 * are not — they are in the connected account's balance, and they leave on the
 * next payout once the bank details are right. Leading with the reassurance is
 * not decoration; it is the difference between a support call and a click.
 *
 * The icon is a shield rather than a warning triangle for the same reason. The
 * failed *rows* below carry the triangle, where it is about one payout rather
 * than about the restaurant's money as a whole.
 */
export function HeldTotalCard({
	restaurantId,
	heldCents,
	currency,
	failedCount,
}: HeldTotalCardProps) {
	const { t } = useTranslation();
	const { openBankDetails, isPending, error } = useUpdateBankDetails(restaurantId);

	return (
		<Surface tone="secondary" rounded="xl" className="p-5 space-y-3" data-testid="held-total-card">
			<div className="flex items-start gap-3">
				<span className="text-success mt-0.5 shrink-0">
					<ShieldCheck size={20} />
				</span>
				<div className="space-y-1">
					<p className="text-sm font-semibold text-success">{t(PayoutsKeys.SAFE_LINE)}</p>
					<h2 className="text-lg font-semibold text-foreground">
						{t(PayoutsKeys.HELD_TITLE, { amount: formatPayoutMoney(heldCents, currency) })}
					</h2>
					<p className="text-sm text-muted-foreground">{t(PayoutsKeys.HELD_BODY)}</p>
					<p className="text-xs text-faint-foreground">
						{t(PayoutsKeys.HELD_COUNT, { count: failedCount })}
					</p>
				</div>
			</div>

			{error && <InlineError message={error} />}

			<Button
				variant="primary"
				size="sm"
				disabled={isPending || !restaurantId}
				onClick={openBankDetails}
			>
				{isPending ? t(PayoutsKeys.HELD_FIX_PENDING) : t(PayoutsKeys.HELD_FIX_CTA)}
			</Button>
		</Surface>
	);
}
