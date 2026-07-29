import type { OrderDashboardStatusFilter } from "@/features";
import type { StatusTone } from "@/global/components";
import { OrdersKeys } from "@/global/i18n";
import type { Urgency } from "@/global/utils/relativeTime";
import type { OrderPaymentState } from "convex/constants";
import type { Doc } from "convex/_generated/dataModel";

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
	readonly tableNumber: number;
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

export const STATUS_CONFIG: Record<OrderDashboardStatusFilter, StatusConfig> = {
	submitted: {
		labelKey: OrdersKeys.STATUS_SUBMITTED,
		tone: "warning",
		next: "preparing",
		nextLabelKey: OrdersKeys.ACTION_ACCEPT,
	},
	preparing: {
		labelKey: OrdersKeys.STATUS_PREPARING,
		tone: "info",
		next: "ready",
		nextLabelKey: OrdersKeys.ACTION_MARK_READY,
	},
	ready: {
		labelKey: OrdersKeys.STATUS_READY,
		tone: "success",
		next: "served",
		nextLabelKey: OrdersKeys.ACTION_MARK_SERVED,
	},
	served: {
		labelKey: OrdersKeys.STATUS_SERVED,
		tone: "neutral",
		next: null,
		nextLabelKey: null,
	},
	cancelled: {
		labelKey: OrdersKeys.STATUS_CANCELLED,
		tone: "danger",
		next: null,
		nextLabelKey: null,
	},
};

export const ALL_STATUSES: OrderDashboardStatusFilter[] = [
	"submitted",
	"preparing",
	"ready",
	"served",
	"cancelled",
];

export const DEFAULT_STATUS_FILTERS: OrderDashboardStatusFilter[] = [
	"submitted",
	"preparing",
	"ready",
];

export const STATUS_SORT_PRIORITY: Record<OrderDashboardStatusFilter, number> = {
	submitted: 0,
	preparing: 1,
	ready: 2,
	served: 3,
	cancelled: 4,
};

/**
 * Money states worth showing on an order card.
 *
 * Deliberately partial: `unpaid`, `pending` and `processing` are the normal
 * pre-payment lifecycle and would be noise on every open ticket. Only states a
 * staff member might need to act on get a badge — and `refund_failed` is the
 * one that must never be missed, because the diner is owed money.
 */
export const PAYMENT_STATE_BADGE: Partial<
	Record<OrderPaymentState, { labelKey: string; tone: StatusTone }>
> = {
	paid: { labelKey: OrdersKeys.CARD_PAID, tone: "success" },
	refund_requested: { labelKey: OrdersKeys.PAYMENT_REFUND_REQUESTED, tone: "warning" },
	refunded: { labelKey: OrdersKeys.PAYMENT_REFUNDED, tone: "info" },
	refund_failed: { labelKey: OrdersKeys.PAYMENT_REFUND_FAILED, tone: "danger" },
};

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

export function isDashboardStatus(status: string): status is OrderDashboardStatusFilter {
	return status in STATUS_CONFIG;
}
