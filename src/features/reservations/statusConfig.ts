import { ReservationsKeys } from "@/global/i18n";
import type { StatusTone } from "@/global/components";

export type ReservationStatus =
	| "pending"
	| "confirmed"
	| "seated"
	| "completed"
	| "cancelled"
	| "no_show";

export type ReservationStatusConfig = {
	value: ReservationStatus;
	labelKey: string;
	tone: StatusTone;
};

/**
 * Single source of truth for reservation status chip metadata. Consumed by
 * the dashboard filter pills and the detail drawer header so the two stay
 * in sync. `labelKey` resolves through `t()` at the call site.
 */
export const RESERVATION_STATUS_CONFIG: ReadonlyArray<ReservationStatusConfig> = [
	{ value: "pending", labelKey: ReservationsKeys.STATUS_PENDING, tone: "warning" },
	{ value: "confirmed", labelKey: ReservationsKeys.STATUS_CONFIRMED, tone: "info" },
	{ value: "seated", labelKey: ReservationsKeys.STATUS_SEATED, tone: "success" },
	{ value: "completed", labelKey: ReservationsKeys.STATUS_COMPLETED, tone: "neutral" },
	{ value: "cancelled", labelKey: ReservationsKeys.STATUS_CANCELLED, tone: "danger" },
	{ value: "no_show", labelKey: ReservationsKeys.STATUS_NO_SHOW, tone: "warning" },
];

export const RESERVATION_FALLBACK_TONE: StatusTone = "neutral";

export function getReservationStatusConfig(
	status: string
): ReservationStatusConfig | undefined {
	return RESERVATION_STATUS_CONFIG.find((s) => s.value === status);
}
