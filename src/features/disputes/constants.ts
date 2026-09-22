import { DisputesKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import { DISPUTE_STATUS, type DisputeStatus } from "convex/constants";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, HelpCircle, Scale, Search } from "lucide-react";

/**
 * Presentation per dispute status (TAVLI-102).
 *
 * The labels are deliberately not Stripe's words. A restaurant does not think
 * in `needs_response` / `warning_under_review`; it thinks "the bank is asking
 * about this" and "the bank took it back". `lost` reads "Reversed", not
 * "Lost" — nothing was lost by the restaurant, and the word invites a reading
 * of blame that the whole surface exists to avoid.
 *
 * `unknown` is a real entry, not a fallback nobody expects: the backend
 * normalizes anything Stripe adds in future onto it, so a new Stripe status
 * renders as "we are looking into it" instead of a raw identifier.
 */
export const DISPUTE_STATUS_LABEL_KEY: Record<DisputeStatus, string> = {
	[DISPUTE_STATUS.WARNING_NEEDS_RESPONSE]: DisputesKeys.STATUS_WARNING_NEEDS_RESPONSE,
	[DISPUTE_STATUS.WARNING_UNDER_REVIEW]: DisputesKeys.STATUS_WARNING_UNDER_REVIEW,
	[DISPUTE_STATUS.WARNING_CLOSED]: DisputesKeys.STATUS_WARNING_CLOSED,
	[DISPUTE_STATUS.NEEDS_RESPONSE]: DisputesKeys.STATUS_NEEDS_RESPONSE,
	[DISPUTE_STATUS.UNDER_REVIEW]: DisputesKeys.STATUS_UNDER_REVIEW,
	[DISPUTE_STATUS.WON]: DisputesKeys.STATUS_WON,
	[DISPUTE_STATUS.LOST]: DisputesKeys.STATUS_LOST,
	[DISPUTE_STATUS.UNKNOWN]: DisputesKeys.STATUS_UNKNOWN,
};

export const DISPUTE_STATUS_ICON: Record<DisputeStatus, LucideIcon> = {
	[DISPUTE_STATUS.WARNING_NEEDS_RESPONSE]: Search,
	[DISPUTE_STATUS.WARNING_UNDER_REVIEW]: Search,
	[DISPUTE_STATUS.WARNING_CLOSED]: CheckCircle2,
	[DISPUTE_STATUS.NEEDS_RESPONSE]: Scale,
	[DISPUTE_STATUS.UNDER_REVIEW]: Scale,
	[DISPUTE_STATUS.WON]: CheckCircle2,
	[DISPUTE_STATUS.LOST]: AlertTriangle,
	[DISPUTE_STATUS.UNKNOWN]: HelpCircle,
};

/**
 * Badge colours, from the design system's tokens rather than invented hues.
 *
 * Only `lost` is destructive, and even that is the muted red the payouts page
 * uses for a failed payout rather than an alarm: it is money that moved, not a
 * system failure. An open dispute is neutral — it is a question, not a problem.
 */
export const DISPUTE_STATUS_BADGE: Record<DisputeStatus, { bgColor: string; textColor: string }> = {
	[DISPUTE_STATUS.WARNING_NEEDS_RESPONSE]: {
		bgColor: "var(--bg-tertiary)",
		textColor: "var(--text-secondary)",
	},
	[DISPUTE_STATUS.WARNING_UNDER_REVIEW]: {
		bgColor: "var(--bg-tertiary)",
		textColor: "var(--text-secondary)",
	},
	[DISPUTE_STATUS.WARNING_CLOSED]: {
		bgColor: "rgba(34, 197, 94, 0.14)",
		textColor: "rgb(22, 143, 70)",
	},
	[DISPUTE_STATUS.NEEDS_RESPONSE]: {
		bgColor: "rgba(35, 131, 226, 0.12)",
		textColor: "rgb(35, 131, 226)",
	},
	[DISPUTE_STATUS.UNDER_REVIEW]: {
		bgColor: "rgba(35, 131, 226, 0.12)",
		textColor: "rgb(35, 131, 226)",
	},
	[DISPUTE_STATUS.WON]: {
		bgColor: "rgba(34, 197, 94, 0.14)",
		textColor: "rgb(22, 143, 70)",
	},
	[DISPUTE_STATUS.LOST]: {
		bgColor: "rgba(220, 38, 38, 0.12)",
		textColor: "rgb(185, 28, 28)",
	},
	[DISPUTE_STATUS.UNKNOWN]: {
		bgColor: "var(--bg-tertiary)",
		textColor: "var(--text-faint)",
	},
};

/**
 * One money string for the whole disputes surface: `$640.00 MXN`.
 *
 * Identical in shape to `formatPayoutMoney`, and deliberately so — the two
 * cards sit on the same page, and two spellings of the same amount read as two
 * different numbers at a glance. The currency **code** stays beside the symbol
 * because `$` is MXN, USD and several others.
 */
export function formatDisputeMoney(cents: number, currency: string): string {
	return `$${formatCents(cents)} ${currency}`.trim();
}
