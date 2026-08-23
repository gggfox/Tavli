import type { OrderDashboardStatusFilter, OrderDashboardStatusFilterValue } from "@/features";
import type { StatusTone } from "@/global/components";
import { OrdersKeys } from "@/global/i18n";
import type { Urgency } from "@/global/utils/relativeTime";
import type { OrderPaymentState } from "convex/constants";
import { owesInPersonPayment } from "convex/orderHelpers";
import type { Doc } from "convex/_generated/dataModel";
import {
	BadgeDollarSign,
	CheckCircle2,
	ChefHat,
	Inbox,
	UtensilsCrossed,
	XCircle,
	type LucideIcon,
} from "lucide-react";

type LiveNameTranslations = Record<string, { name?: string }>;
type LiveNameDescriptionTranslations = Record<string, { name?: string; description?: string }>;

export type DashboardSelectedOption = Doc<"orderItems">["selectedOptions"][number] & {
	readonly optionTranslations?: LiveNameTranslations;
	readonly optionGroupTranslations?: LiveNameTranslations;
};

export type DashboardOrderItem = Omit<Doc<"orderItems">, "selectedOptions"> & {
	readonly menuItemTranslations?: LiveNameDescriptionTranslations;
	readonly selectedOptions: ReadonlyArray<DashboardSelectedOption>;
	/**
	 * Resolved prep station for this item. Computed by the orders query
	 * via live lookup of `menuItems.prepStation` (no snapshot on the
	 * orderItems row — see ADR 005). Falls back to "kitchen" when the
	 * source menu item has been soft-deleted.
	 */
	readonly prepStation: "kitchen" | "bar";
};

export type DashboardOrder = Doc<"orders"> & {
	readonly items: ReadonlyArray<DashboardOrderItem>;
	/**
	 * Table this order goes to, joined by the dashboard query. `null` when
	 * that table row is gone (deleted or purged) — the cards render an
	 * explicit "no table" rather than the old `?? 0`, which was
	 * indistinguishable from a real table numbered 0.
	 */
	readonly tableNumber: number | null;
	/**
	 * `restaurants.releaseCashOrdersImmediately`, joined per card by the
	 * dashboard query (TAVLI-81). Carried on the order rather than fetched
	 * separately so the card, the station rail and the action row cannot
	 * disagree about whether this round may be worked before its cash is
	 * collected. `false` is the ADR 008 default: collect, then cook.
	 */
	readonly cashReleasedImmediately: boolean;
};

/**
 * Subset of order statuses accepted by `api.orders.updateStatus`. Note
 * the explicit absence of `"submitted"` -- the dashboard never advances
 * an order back into the queue.
 */
export type NextOrderStatus = "preparing" | "ready" | "served" | "cancelled";

export type StatusConfig = {
	labelKey: string;
	tone: StatusTone;
	/**
	 * Segment glyph for the status filter. Deliberately the same icons the
	 * order card uses on its advance-to-this-status button, so "the button
	 * that makes an order ready" and "the ready segment" read as one thing.
	 */
	icon: LucideIcon;
	next: NextOrderStatus | null;
	nextLabelKey: string | null;
};

export const URGENCY_TEXT_CLASS: Record<Urgency, string> = {
	fresh: "text-success",
	stale: "text-warning",
	cold: "text-destructive",
};

export const URGENCY_BG_CLASS: Record<Urgency, string> = {
	fresh: "bg-success",
	stale: "bg-warning",
	cold: "bg-destructive",
};

export const STATUS_CONFIG: Record<OrderDashboardStatusFilterValue, StatusConfig> = {
	// Money owed, not workflow: the only actions are "mark paid in person"
	// and cancel, both rendered by the OrderCard awaiting-payment variant —
	// hence no `next` transition here (ADR 008). A restaurant that releases
	// cash orders immediately overrides this row through `nextActionFor`,
	// which is the frontend mirror of the backend's transition table.
	awaiting_payment: {
		labelKey: OrdersKeys.STATUS_AWAITING_PAYMENT,
		tone: "urgent",
		icon: BadgeDollarSign,
		next: null,
		nextLabelKey: null,
	},
	submitted: {
		labelKey: OrdersKeys.STATUS_SUBMITTED,
		tone: "warning",
		icon: Inbox,
		next: "preparing",
		nextLabelKey: OrdersKeys.ACTION_ACCEPT,
	},
	preparing: {
		labelKey: OrdersKeys.STATUS_PREPARING,
		tone: "info",
		icon: ChefHat,
		next: "ready",
		nextLabelKey: OrdersKeys.ACTION_MARK_READY,
	},
	ready: {
		labelKey: OrdersKeys.STATUS_READY,
		tone: "success",
		icon: CheckCircle2,
		next: "served",
		nextLabelKey: OrdersKeys.ACTION_MARK_SERVED,
	},
	served: {
		labelKey: OrdersKeys.STATUS_SERVED,
		tone: "neutral",
		icon: UtensilsCrossed,
		next: null,
		nextLabelKey: null,
	},
	cancelled: {
		labelKey: OrdersKeys.STATUS_CANCELLED,
		tone: "danger",
		icon: XCircle,
		next: null,
		nextLabelKey: null,
	},
};

/** Segment order of the dashboard's single-select status control. */
export const ALL_STATUSES: OrderDashboardStatusFilterValue[] = [
	"awaiting_payment",
	"submitted",
	"preparing",
	"ready",
	"served",
	"cancelled",
];

/** What a user who never picked a status sees first: the queue. */
export const DEFAULT_STATUS: OrderDashboardStatusFilterValue = "submitted";

/**
 * Highest-priority-first order used to collapse the LEGACY multi-select
 * filter array into the single-select value. Must match the rule of
 * `convex/migrations/backfillOrderDashboardStatusFilter.ts` so a user who
 * renders before the migration ran lands on the same segment the migration
 * would give them. `awaiting_payment` is absent by construction: the legacy
 * array predates that status.
 */
export const LEGACY_STATUS_PRIORITY: readonly OrderDashboardStatusFilter[] = [
	"submitted",
	"preparing",
	"ready",
	"served",
	"cancelled",
];

/**
 * Collapse the legacy multi-select filter array into a single-select value.
 * `null` in → `null` out (setting never loaded / never set), so callers can
 * keep distinguishing "unknown yet" from a real value.
 */
export function collapseLegacyStatusFilters(
	legacy: readonly OrderDashboardStatusFilter[] | null
): OrderDashboardStatusFilterValue | null {
	if (legacy === null) return null;
	return LEGACY_STATUS_PRIORITY.find((status) => legacy.includes(status)) ?? DEFAULT_STATUS;
}

export const STATUS_SORT_PRIORITY: Record<OrderDashboardStatusFilterValue, number> = {
	awaiting_payment: 0,
	submitted: 1,
	preparing: 2,
	ready: 3,
	served: 4,
	cancelled: 5,
};

export interface PaymentBadgeConfig {
	readonly labelKey: string;
	readonly tone: StatusTone;
	/** Defaults to a card glyph; cash owed gets the money glyph instead. */
	readonly icon?: LucideIcon;
}

/**
 * Money states worth showing on an order card.
 *
 * `unpaid` used to be omitted as pre-payment noise. It stopped being noise the
 * moment an unpaid round could be on the rail (TAVLI-81): under pay-at-submit
 * every order the kitchen sees is already paid, so "unpaid" on a live ticket
 * now means one thing — this table owes cash. `processing` stays out: it is a
 * card charge mid-flight, nothing staff can act on.
 *
 * `refund_failed` remains the one that must never be missed, because the diner
 * is owed money.
 */
export const PAYMENT_STATE_BADGE: Partial<Record<OrderPaymentState, PaymentBadgeConfig>> = {
	unpaid: { labelKey: OrdersKeys.PAYMENT_TO_COLLECT, tone: "urgent", icon: BadgeDollarSign },
	pending: { labelKey: OrdersKeys.PAYMENT_PENDING, tone: "warning" },
	paid: { labelKey: OrdersKeys.CARD_PAID, tone: "success" },
	refund_requested: { labelKey: OrdersKeys.PAYMENT_REFUND_REQUESTED, tone: "warning" },
	refunded: { labelKey: OrdersKeys.PAYMENT_REFUNDED, tone: "info" },
	refund_failed: { labelKey: OrdersKeys.PAYMENT_REFUND_FAILED, tone: "danger" },
};

/**
 * The badge an order card shows for its money, or `undefined` for none.
 *
 * A round that owes cash gets the "to collect" badge regardless of what
 * `paymentState` says, because a cash order may carry no `paymentState` at all
 * — `requestPayInPerson` writes none — and once the restaurant releases such a
 * round to the kitchen the badge is the ONLY thing left saying the money is
 * still out (`status` has moved on to `preparing`/`ready`/`served`). That is
 * the persistent sticker this ticket exists for.
 */
export function orderPaymentBadge(order: {
	readonly status: string;
	readonly paymentState?: OrderPaymentState;
	readonly awaitingPaymentAt?: number;
	readonly paidAt?: number;
}): PaymentBadgeConfig | undefined {
	if (owesInPersonPayment(order)) return PAYMENT_STATE_BADGE.unpaid;
	return order.paymentState ? PAYMENT_STATE_BADGE[order.paymentState] : undefined;
}

/**
 * The forward action an order card offers, mirroring the backend's
 * `allowedOrderTransitions`.
 *
 * `awaiting_payment` has no forward action of its own (ADR 008), but where the
 * restaurant releases cash orders immediately it is real kitchen work and takes
 * `submitted`'s action verbatim — the same borrow the backend makes, so the
 * button a station sees and the transition the server accepts cannot drift.
 */
export function nextActionFor(
	status: string,
	cashReleasedImmediately: boolean
): { next: NextOrderStatus; nextLabelKey: string } | null {
	const config =
		cashReleasedImmediately && status === "awaiting_payment"
			? STATUS_CONFIG.submitted
			: STATUS_CONFIG[status as OrderDashboardStatusFilterValue];
	if (!config?.next || !config.nextLabelKey) return null;
	return { next: config.next, nextLabelKey: config.nextLabelKey };
}

export const MAX_VISIBLE_ITEMS = 7;

export function formatOrderTime(timestamp: number, locale: string): string {
	return new Date(timestamp).toLocaleTimeString(locale, {
		hour: "numeric",
		minute: "2-digit",
	});
}

export function formatOrderDate(timestamp: number, locale: string): string {
	return new Intl.DateTimeFormat(locale, {
		day: "2-digit",
		month: "short",
		year: "numeric",
	}).format(new Date(timestamp));
}

export function isDashboardStatus(status: string): status is OrderDashboardStatusFilterValue {
	return status in STATUS_CONFIG;
}
