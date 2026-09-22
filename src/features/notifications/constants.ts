import type { LucideIcon } from "lucide-react";
import { AlertTriangle, BadgeCheck, Banknote, CircleCheck, CircleX } from "lucide-react";
import { NOTIFICATION_KIND, type NotificationKind } from "convex/constants";

/**
 * Icon per kind. Chargebacks and payouts are the two stories these
 * notifications tell, so each has a "went wrong" and a "came right" face — a
 * manager should be able to read the outcome before reading the sentence.
 */
export const NOTIFICATION_KIND_ICON: Record<NotificationKind, LucideIcon> = {
	[NOTIFICATION_KIND.DISPUTE_OPENED]: AlertTriangle,
	[NOTIFICATION_KIND.DISPUTE_WON]: BadgeCheck,
	[NOTIFICATION_KIND.DISPUTE_LOST]: CircleX,
	[NOTIFICATION_KIND.PAYOUT_FAILED]: Banknote,
	[NOTIFICATION_KIND.PAYOUTS_RESUMED]: CircleCheck,
};

/**
 * Icon colour per kind, from the design system's tokens rather than invented
 * hues: money lost or held reads as destructive, money recovered as success.
 */
export const NOTIFICATION_KIND_ICON_CLASS: Record<NotificationKind, string> = {
	[NOTIFICATION_KIND.DISPUTE_OPENED]: "text-destructive",
	[NOTIFICATION_KIND.DISPUTE_WON]: "text-success",
	[NOTIFICATION_KIND.DISPUTE_LOST]: "text-destructive",
	[NOTIFICATION_KIND.PAYOUT_FAILED]: "text-destructive",
	[NOTIFICATION_KIND.PAYOUTS_RESUMED]: "text-success",
};

/** Badge caps out rather than widening the sidebar with a four-digit number. */
export const NOTIFICATION_BADGE_MAX = 99;
