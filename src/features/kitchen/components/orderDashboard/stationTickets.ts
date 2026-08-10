import { hasStationTicket } from "convex/orderHelpers";
import type { DashboardPrepStation } from "./stationConfig";
import type { DashboardOrder, DashboardOrderItem } from "./statusConfig";

/**
 * One station's portion of an Order, as shown on that station's dashboard.
 * A projection derived at render time — there is no such document, and the
 * Order remains the unit of payment, cancellation, and history (ADR 007).
 */
export interface StationTicket {
	readonly order: DashboardOrder;
	readonly station: DashboardPrepStation;
	readonly items: ReadonlyArray<DashboardOrderItem>;
}

/**
 * Project the dashboard's orders into the tickets a single station should be
 * looking at, preserving the caller's sort order.
 *
 * Three rules decide what stays on the rail:
 *
 * 1. Only `submitted` and `preparing` orders produce tickets. A `ready` order
 *    has nothing left for a station to do — including one flipped straight to
 *    `ready` by the whole-order action, which leaves no station stamps behind
 *    and would otherwise strand an unactionable card here. `served` and
 *    `cancelled` are closed. `awaiting_payment` (ADR 008) must NEVER reach a
 *    station rail: the kitchen only sees an order once its cash is collected,
 *    so it is excluded here by the same status allowlist.
 * 2. Items are the station's own, minus 86'd lines — a station never sees the
 *    other station's work, and never sees what it no longer has to make.
 * 3. The ticket bumps (leaves the rail) once the station has stamped ready, or
 *    once it has no live items left. Stamping means the portion left the
 *    station, so what remains on screen is only work still to do.
 *
 * The rules themselves live in `hasStationTicket` (convex/orderHelpers), which
 * the backend segment counts share — a segment reading "Preparing (4)" over a
 * rail holding three tickets is exactly the drift that splitting them invites.
 */
export function deriveStationTickets(
	orders: ReadonlyArray<DashboardOrder>,
	station: DashboardPrepStation
): StationTicket[] {
	const tickets: StationTicket[] = [];

	for (const order of orders) {
		const items = order.items.filter(
			(item) => item.prepStation === station && item.cancelledAt === undefined
		);

		const visible = hasStationTicket({
			status: order.status,
			stationStamp: station === "kitchen" ? order.kitchenReadyAt : order.barReadyAt,
			liveStationItemCount: items.length,
		});
		if (!visible) continue;

		tickets.push({ order, station, items });
	}

	return tickets;
}
