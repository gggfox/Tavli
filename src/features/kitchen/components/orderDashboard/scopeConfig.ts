/**
 * Scope filter configuration for the OrderDashboard (TAVLI-82).
 *
 * A fourth orthogonal axis alongside status, prep station, and service day:
 * WHOSE work it is. "Mine" is the tables the user covers right now through
 * their active shift's section assignments — what a server carrying plates
 * actually needs on screen — while "All" is the whole floor.
 */
import type { OrderDashboardScope } from "@/features";
import { OrdersKeys } from "@/global/i18n";
import { LayoutGrid, UserCheck, type LucideIcon } from "lucide-react";

export type ScopeFilterValue = OrderDashboardScope;

/**
 * Fallback for a user whose shift gives no reason to scope: the whole floor,
 * which is what the board did before this control existed. A server on a
 * server shift gets "mine" instead — see `orders.getDashboardScopeContext`.
 */
export const DEFAULT_SCOPE: ScopeFilterValue = "all";

/** Segment order of the scope control. */
export const ALL_SCOPE_VALUES: ScopeFilterValue[] = ["mine", "all"];

export const SCOPE_ICON: Record<ScopeFilterValue, LucideIcon> = {
	mine: UserCheck,
	all: LayoutGrid,
};

export const SCOPE_LABEL_KEY: Record<ScopeFilterValue, string> = {
	mine: OrdersKeys.SCOPE_MINE,
	all: OrdersKeys.SCOPE_ALL,
};
