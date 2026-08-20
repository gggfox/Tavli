import { getStatusToneStyle } from "@/global/components";
import { useTranslation } from "react-i18next";
import { CreditCard } from "lucide-react";
import type { OrderPaymentState } from "convex/constants";
import { orderPaymentBadge } from "./statusConfig";

/**
 * Money state for a single order, shown alongside its status.
 *
 * Renders nothing for the ordinary in-flight states so open tickets stay
 * uncluttered — see `PAYMENT_STATE_BADGE`. Two states matter most here:
 * `refund_failed`, because the order was cancelled and the diner was not
 * refunded and nothing else in the app surfaces that; and cash still owed,
 * which follows the round through every status once the restaurant releases
 * cash orders to the kitchen (TAVLI-81).
 *
 * Takes the order rather than a bare `paymentState` because "this table still
 * owes cash" is not a `paymentState` — a cash round may carry none at all.
 */
export function PaymentStateBadge({
	order,
}: {
	readonly order: {
		readonly status: string;
		readonly paymentState?: OrderPaymentState;
		readonly awaitingPaymentAt?: number;
		readonly paidAt?: number;
	};
}) {
	const { t } = useTranslation();
	const badge = orderPaymentBadge(order);
	if (!badge) return null;

	const tone = getStatusToneStyle(badge.tone);
	const Icon = badge.icon ?? CreditCard;

	return (
		<span
			className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0"
			style={{ backgroundColor: tone.solidBg, color: tone.solidFg }}
		>
			<Icon size={10} />
			{t(badge.labelKey)}
		</span>
	);
}
