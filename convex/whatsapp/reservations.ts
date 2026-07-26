/**
 * Reservation reads for the WhatsApp assistant's tools.
 *
 * Mirrors `menu.ts`: internal queries in the default runtime, called from the
 * `"use node"` action in `llm.ts` via `ctx.runQuery`.
 *
 * Every return value here is an **explicit allowlisted projection**, never a
 * `Doc`. Whatever a tool returns enters the model's context and can be echoed to
 * the customer verbatim, so the shape is the security boundary — the same
 * reasoning as `toDinerVisiblePayment` in `_util/dinerSession.ts`. In particular
 * reservation ids never leave this module: the assistant has no tool that accepts
 * one, and giving it one to repeat would create the enumeration surface the
 * design exists to avoid.
 *
 * Times cross the boundary as restaurant-local `YYYY-MM-DD` / `HH:MM` strings
 * rather than epoch ms, so the model has no timestamp to invent variations of.
 */
import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import {
	computeEndsAt,
	computeTurnMinutes,
	intersectsBlackout,
	isWithinHorizon,
	isWithinOperatingHours,
	resolveServiceWindow,
} from "../_util/availability";
import { loadEffectiveSettings } from "../_util/reservationSettings";
import { formatHm } from "../_util/timezone";
import {
	MAX_PARTY_SIZE,
	findSuggestedTimes,
	findUpcomingByPhone,
	isBookablePartySize,
	isPartyBookableAt,
} from "../reservationHelpers";
import { RESERVATION_SOURCE, TABLE } from "../constants";
import { nowInRestaurant, resolveRequestedStart, toLocalDateTimeParts } from "./datetime";

/** How many alternative times we ever offer. Keeps the reply short. */
const MAX_ALTERNATIVES = 3;

/**
 * Booking policy and the restaurant's current local time, for the system prompt.
 * No PII — the same information the public reservation form already reads.
 */
export const internalGetBookingContextForBot = internalQuery({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args) => {
		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) return null;
		const settings = await loadEffectiveSettings(ctx, args.restaurantId);
		const window = resolveServiceWindow(restaurant);
		const now = nowInRestaurant(restaurant.timezone, Date.now());

		return {
			acceptingReservations: settings.acceptingReservations,
			minAdvanceMinutes: settings.minAdvanceMinutes,
			maxAdvanceDays: settings.maxAdvanceDays,
			maxPartySize: MAX_PARTY_SIZE,
			openTime: formatHm(window.openMinutes),
			closeTime: formatHm(window.closeMinutes),
			todayDate: now.date,
			nowTime: now.time,
			weekday: now.weekday,
			timezone: now.timezone,
		};
	},
});

/**
 * Can this party be seated at this local date/time? Returns a reason code and up
 * to three alternative `HH:MM` times when not.
 */
export const internalCheckAvailabilityForBot = internalQuery({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		partySize: v.number(),
		date: v.string(),
		time: v.string(),
	},
	handler: async (ctx, args) => {
		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) return { available: false, reason: "ERROR_NOT_FOUND", alternatives: [] };

		const resolved = resolveRequestedStart({
			date: args.date,
			time: args.time,
			timezone: restaurant.timezone,
		});
		if (!resolved) {
			// The model sent something other than YYYY-MM-DD / HH:MM. Tell it so it
			// can retry rather than silently guessing a time for the customer.
			return { available: false, reason: "ERROR_INVALID_DATE_OR_TIME", alternatives: [] };
		}
		if (!isBookablePartySize(args.partySize)) {
			return { available: false, reason: "ERROR_INVALID_PARTY_SIZE", alternatives: [] };
		}

		const settings = await loadEffectiveSettings(ctx, args.restaurantId);
		const turnMinutes = computeTurnMinutes(settings, args.partySize);
		const endsAt = computeEndsAt(resolved.startsAt, turnMinutes);
		const base = { date: resolved.date, time: resolved.time, turnMinutes };

		if (!settings.acceptingReservations) {
			return {
				...base,
				available: false,
				reason: "ERROR_NOT_ACCEPTING_RESERVATIONS",
				alternatives: [],
			};
		}
		if (
			!isWithinHorizon({
				minAdvanceMinutes: settings.minAdvanceMinutes,
				maxAdvanceDays: settings.maxAdvanceDays,
				startsAt: resolved.startsAt,
				now: Date.now(),
			})
		) {
			return {
				...base,
				available: false,
				reason: "ERROR_OUTSIDE_BOOKING_HORIZON",
				alternatives: [],
			};
		}
		if (intersectsBlackout(settings, resolved.startsAt, endsAt)) {
			return { ...base, available: false, reason: "ERROR_BLACKOUT_WINDOW", alternatives: [] };
		}
		if (
			!isWithinOperatingHours({
				startsAt: resolved.startsAt,
				endsAt,
				window: resolveServiceWindow(restaurant),
			})
		) {
			return {
				...base,
				available: false,
				reason: "ERROR_OUTSIDE_OPERATING_HOURS",
				alternatives: [],
			};
		}

		const bookable = await isPartyBookableAt(
			ctx,
			args.restaurantId,
			args.partySize,
			resolved.startsAt,
			endsAt
		);
		if (bookable) {
			return { ...base, available: true, reason: null, alternatives: [] };
		}

		const suggested = await findSuggestedTimes(
			ctx,
			args.restaurantId,
			args.partySize,
			resolved.startsAt,
			turnMinutes
		);
		return {
			...base,
			available: false,
			reason: "ERROR_NO_TABLES_AVAILABLE",
			// Local HH:MM strings, not epoch ms — see the module docstring.
			alternatives: suggested
				.slice(0, MAX_ALTERNATIVES)
				.map((ms) => toLocalDateTimeParts(ms, restaurant.timezone)),
		};
	},
});

/**
 * The messaging customer's own upcoming bookings.
 *
 * `phone` comes from the action's closure (Twilio's verified `From`), never from
 * a tool argument. The projection drops `_id`, `contact`, `notes`, `email`,
 * `userId`, `idempotencyKey` and `tableIds`.
 */
export const internalListMyReservationsForBot = internalQuery({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		phone: v.string(),
	},
	handler: async (ctx, args) => {
		const restaurant = await ctx.db.get(args.restaurantId);
		const phone = args.phone.trim();
		if (!restaurant || !phone) return { reservations: [] };

		const rows = await findUpcomingByPhone(ctx, {
			restaurantId: args.restaurantId,
			phone,
			nowMs: Date.now(),
			sources: [RESERVATION_SOURCE.WHATSAPP],
		});

		return {
			reservations: rows.map((r) => ({
				...toLocalDateTimeParts(r.startsAt, restaurant.timezone),
				partySize: r.partySize,
				status: r.status,
			})),
		};
	},
});
