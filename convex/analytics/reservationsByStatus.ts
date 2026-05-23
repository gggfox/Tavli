/**
 * `reservationsByStatus` widget query: count of reservations starting in
 * the window grouped by status. Single-restaurant; available to any staff.
 */
import { v } from "convex/values";
import { query } from "../_generated/server";
import { AsyncReturn } from "../_shared/types";
import {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundErrorObject,
	UserInputValidationErrorObject,
} from "../_shared/errors";
import { RESERVATION_STATUS, TABLE, type ReservationStatus } from "../constants";
import { buildWindow, loadReservationsInRange, resolveRestaurantIds } from "./_shared";

const RESERVATIONS_BY_STATUS_MAX_RANGE_DAYS = 366;

export type StatusBucket = { status: ReservationStatus; count: number };

type Errors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| NotFoundErrorObject
	| UserInputValidationErrorObject;

const ALL_STATUSES: ReservationStatus[] = [
	RESERVATION_STATUS.PENDING,
	RESERVATION_STATUS.CONFIRMED,
	RESERVATION_STATUS.SEATED,
	RESERVATION_STATUS.COMPLETED,
	RESERVATION_STATUS.CANCELLED,
	RESERVATION_STATUS.NO_SHOW,
];

export const compute = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		range: v.object({ from: v.number(), to: v.number() }),
	},
	handler: async function (ctx, args): AsyncReturn<StatusBucket[], Errors> {
		const [restaurantIds, accessErr] = await resolveRestaurantIds(ctx, {
			scopeKind: "restaurant",
			restaurantId: args.restaurantId,
		});
		if (accessErr) return [null, accessErr];

		const [windowResult, rangeErr] = buildWindow(
			args.range,
			false,
			RESERVATIONS_BY_STATUS_MAX_RANGE_DAYS
		);
		if (rangeErr) return [null, rangeErr];

		const reservations = await loadReservationsInRange(ctx, restaurantIds, windowResult.current);

		const counts = new Map<ReservationStatus, number>();
		for (const status of ALL_STATUSES) counts.set(status, 0);
		for (const r of reservations) {
			counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
		}

		return [ALL_STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0 })), null];
	},
});
