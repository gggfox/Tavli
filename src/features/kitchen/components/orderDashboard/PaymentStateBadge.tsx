import { getStatusToneStyle } from "@/global/components";
import { useTranslation } from "react-i18next";
import { CreditCard } from "lucide-react";
import type { OrderPaymentState } from "convex/constants";
import { PAYMENT_STATE_BADGE } from "./statusConfig";

/**
 * Money state for a single order, shown alongside its status.
 *
 * Renders nothing for the ordinary pre-payment states so open tickets stay
 * uncluttered — see `PAYMENT_STATE_BADGE`. The state that matters most here is
 * `refund_failed`: the order was cancelled but the diner was not refunded, and
 * nothing else in the app surfaces that.
 */
export function PaymentStateBadge({ paymentState }: { paymentState?: OrderPaymentState }) {
	const { t } = useTranslation();
	const badge = paymentState ? PAYMENT_STATE_BADGE[paymentState] : undefined;
	if (!badge) return null;

	const tone = getStatusToneStyle(badge.tone);

	return (
		<span
			className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0"
			style={{ backgroundColor: tone.solidBg, color: tone.solidFg }}
		>
			<CreditCard size={10} />
			{t(badge.labelKey)}
		</span>
	);
}
