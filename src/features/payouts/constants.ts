import { PayoutsKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import { STRIPE_PAYOUT_STATUS, type StripePayoutStatus } from "convex/constants";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, CircleSlash, Clock, Send } from "lucide-react";

/**
 * Presentation per payout status (TAVLI-103).
 *
 * The labels are deliberately not Stripe's words. A restaurant does not think
 * in `in_transit` / `paid`; it thinks "on the way" / "arrived". `failed` is the
 * one that matters most: it reads "Did not arrive", not "Failed", because
 * nothing failed on the restaurant's side and the money is not gone.
 */
export const PAYOUT_STATUS_LABEL_KEY: Record<StripePayoutStatus, string> = {
	[STRIPE_PAYOUT_STATUS.PENDING]: PayoutsKeys.STATUS_PENDING,
	[STRIPE_PAYOUT_STATUS.IN_TRANSIT]: PayoutsKeys.STATUS_IN_TRANSIT,
	[STRIPE_PAYOUT_STATUS.PAID]: PayoutsKeys.STATUS_PAID,
	[STRIPE_PAYOUT_STATUS.FAILED]: PayoutsKeys.STATUS_FAILED,
	[STRIPE_PAYOUT_STATUS.CANCELED]: PayoutsKeys.STATUS_CANCELED,
};

export const PAYOUT_STATUS_ICON: Record<StripePayoutStatus, LucideIcon> = {
	[STRIPE_PAYOUT_STATUS.PENDING]: Clock,
	[STRIPE_PAYOUT_STATUS.IN_TRANSIT]: Send,
	[STRIPE_PAYOUT_STATUS.PAID]: CheckCircle2,
	[STRIPE_PAYOUT_STATUS.FAILED]: AlertTriangle,
	[STRIPE_PAYOUT_STATUS.CANCELED]: CircleSlash,
};

/**
 * Badge colours, from the design system's tokens rather than invented hues.
 * A failed payout is the only destructive one — a cancelled payout is a
 * non-event, and "preparing" is not a warning.
 */
export const PAYOUT_STATUS_BADGE: Record<
	StripePayoutStatus,
	{ bgColor: string; textColor: string }
> = {
	[STRIPE_PAYOUT_STATUS.PENDING]: {
		bgColor: "var(--bg-tertiary)",
		textColor: "var(--text-secondary)",
	},
	[STRIPE_PAYOUT_STATUS.IN_TRANSIT]: {
		bgColor: "rgba(35, 131, 226, 0.12)",
		textColor: "rgb(35, 131, 226)",
	},
	[STRIPE_PAYOUT_STATUS.PAID]: {
		bgColor: "rgba(34, 197, 94, 0.14)",
		textColor: "rgb(22, 143, 70)",
	},
	[STRIPE_PAYOUT_STATUS.FAILED]: {
		bgColor: "rgba(220, 38, 38, 0.12)",
		textColor: "rgb(185, 28, 28)",
	},
	[STRIPE_PAYOUT_STATUS.CANCELED]: {
		bgColor: "var(--bg-tertiary)",
		textColor: "var(--text-faint)",
	},
};

/** Where the payouts page lives, so the banner and the tests agree on one string. */
export const PAYOUTS_ROUTE = "/admin/payouts" as const;

/**
 * One money string for the whole payouts surface: `$1,000.00 MXN`.
 *
 * A helper rather than a convention, because the held card, the banner and the
 * rows all render the same money and were free to drift — the card said
 * `1,000.00 MXN` while the row beneath it said `$1,000.00 MXN` for the same
 * payout, which reads as two different numbers at a glance. The copy keys take
 * this as one `{{amount}}` param so a translator cannot reintroduce the gap by
 * moving the symbol.
 *
 * The currency **code** stays alongside the symbol on purpose: `$` is MXN, USD
 * and several others, and this is the one page where the restaurant is counting
 * its own money.
 */
export function formatPayoutMoney(cents: number, currency: string): string {
	return `$${formatCents(cents)} ${currency}`.trim();
}
