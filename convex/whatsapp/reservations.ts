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
import type { DatabaseReader } from "../_generated/server";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
	computeEndsAt,
	computeTurnMinutes,
	intersectsBlackout,
	isWithinHorizon,
	isWithinOperatingHours,
	resolveServiceWindow,
} from "../_util/availability";
import { appendAuditEvent } from "../_util/audit";
import { consumeRateLimit } from "../_util/rateLimit";
import { loadEffectiveSettings } from "../_util/reservationSettings";
import { formatHm } from "../_util/timezone";
import {
	CUSTOMER_CANCELLABLE_STATUSES,
	MAX_CONTACT_NAME_LENGTH,
	MAX_NOTES_LENGTH,
	MAX_PARTY_SIZE,
	cancelReservationCore,
	checkTablesFreeForReservation,
	createReservationCore,
	ensureCancellable,
	findSuggestedTimes,
	findUpcomingByPhone,
	isBookablePartySize,
	isPartyBookableAt,
} from "../reservationHelpers";
import { CUSTOMER_CANCEL_REASON } from "../reservations";
import {
	AUDIT_ACTOR,
	AUDIT_EVENT,
	RESERVATION_SOURCE,
	RESERVATION_STATUS,
	TABLE,
	WHATSAPP_CONFIRMATION_CODE_DIGITS,
	WHATSAPP_PENDING_ACTION,
	WHATSAPP_PENDING_ACTION_TTL_MS,
	WHATSAPP_WRITE_RATE_LIMIT,
} from "../constants";
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

		const suggested = await findSuggestedTimes(ctx, {
			restaurant,
			settings,
			partySize: args.partySize,
			startsAt: resolved.startsAt,
			turnMinutes,
		});
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

// ============================================================================
// Writes
// ============================================================================

/**
 * Consume one unit of the per-phone assistant write budget.
 *
 * `createReservationCore` already caps bookings at 5 rows/hour/phone, but
 * cancellation has no limiter of its own, and neither bounds the two together.
 */
export const internalConsumeWriteBudget = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		phone: v.string(),
	},
	handler: async (ctx, args) => {
		const decision = await consumeRateLimit(
			ctx,
			`whatsapp_write:${args.restaurantId}:${args.phone}`,
			WHATSAPP_WRITE_RATE_LIMIT
		);
		return { allowed: decision.allowed };
	},
});

/**
 * Create a reservation for the messaging customer.
 *
 * `phone` and `restaurantId` come from the action's closure, never from tool
 * arguments. `contact.email` is deliberately not accepted at all: the attempt
 * limiter keys partly on email and is shared across sources, so a model-supplied
 * address could burn a stranger's budget and lock them out of the web form.
 */
export const internalBookForBot = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		phone: v.string(),
		name: v.string(),
		partySize: v.number(),
		date: v.string(),
		time: v.string(),
		notes: v.optional(v.string()),
		idempotencyKey: v.string(),
	},
	handler: async (ctx, args) => {
		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) return { booked: false as const, reason: "ERROR_NOT_FOUND" };

		const resolved = resolveRequestedStart({
			date: args.date,
			time: args.time,
			timezone: restaurant.timezone,
		});
		if (!resolved) {
			return { booked: false as const, reason: "ERROR_INVALID_DATE_OR_TIME" };
		}

		const [reservationId, error] = await createReservationCore(ctx, {
			restaurantId: args.restaurantId,
			partySize: args.partySize,
			startsAt: resolved.startsAt,
			contact: {
				name: args.name.slice(0, MAX_CONTACT_NAME_LENGTH),
				phone: args.phone,
			},
			source: RESERVATION_SOURCE.WHATSAPP,
			notes: args.notes?.slice(0, MAX_NOTES_LENGTH),
			idempotencyKey: args.idempotencyKey,
		});

		if (error) {
			// Project to the stable code only. The raw error object can carry a
			// `fields` array naming internal paths, and everything returned here
			// enters model context and may be echoed to the customer.
			return { booked: false as const, reason: error.message };
		}

		return {
			booked: true as const,
			reservationId,
			date: resolved.date,
			time: resolved.time,
			partySize: args.partySize,
			startsAt: resolved.startsAt,
			// The assistant must never imply a table is held: staff still confirm.
			status: RESERVATION_STATUS.PENDING,
			awaitingRestaurantConfirmation: true,
		};
	},
});

/** Largest multiple of 10 under 256, for unbiased digit sampling. */
const UNBIASED_BYTE_MAX = 256 - (256 % 10);

function randomCode(digits: number): string {
	const byte = new Uint8Array(1);
	const out: string[] = [];
	for (let i = 0; i < digits; i++) {
		do {
			crypto.getRandomValues(byte);
		} while (byte[0] >= UNBIASED_BYTE_MAX);
		out.push(String(byte[0] % 10));
	}
	return out.join("");
}

/**
 * Is this party seatable at this instant? Shared by the reschedule request and
 * its redemption so the answer cannot drift between quoting a time and applying
 * it — the ten minutes a code stays live are long enough for the slot to go.
 *
 * `excludeReservationId` is what makes moving an *assigned* booking work: its
 * own row holds those tables, so without the exclusion a booking would block
 * itself out of any overlapping new time (the same reason
 * `checkTablesFreeForReservation` takes it on the staff path).
 */
async function evaluateMove(
	ctx: { db: DatabaseReader },
	restaurant: Doc<typeof TABLE.RESTAURANTS>,
	args: {
		partySize: number;
		startsAt: number;
		excludeReservationId: Id<typeof TABLE.RESERVATIONS>;
		assignedTableIds: Id<typeof TABLE.TABLES>[];
	}
): Promise<{ ok: true; endsAt: number } | { ok: false; reason: string }> {
	if (!isBookablePartySize(args.partySize)) {
		return { ok: false, reason: "ERROR_INVALID_PARTY_SIZE" };
	}
	const settings = await loadEffectiveSettings(ctx, restaurant._id);
	const endsAt = computeEndsAt(args.startsAt, computeTurnMinutes(settings, args.partySize));

	if (!settings.acceptingReservations) {
		return { ok: false, reason: "ERROR_NOT_ACCEPTING_RESERVATIONS" };
	}
	if (
		!isWithinHorizon({
			minAdvanceMinutes: settings.minAdvanceMinutes,
			maxAdvanceDays: settings.maxAdvanceDays,
			startsAt: args.startsAt,
			now: Date.now(),
		})
	) {
		return { ok: false, reason: "ERROR_OUTSIDE_BOOKING_HORIZON" };
	}
	if (intersectsBlackout(settings, args.startsAt, endsAt)) {
		return { ok: false, reason: "ERROR_BLACKOUT_WINDOW" };
	}
	if (
		!isWithinOperatingHours({
			startsAt: args.startsAt,
			endsAt,
			window: resolveServiceWindow(restaurant),
		})
	) {
		return { ok: false, reason: "ERROR_OUTSIDE_OPERATING_HOURS" };
	}

	// An assigned booking is checked against its own tables (minus itself); an
	// unassigned one — every booking the assistant makes, until staff seat it —
	// against the floor as a whole.
	if (args.assignedTableIds.length > 0) {
		const tables = [];
		for (const id of args.assignedTableIds) {
			const table = await ctx.db.get(id);
			if (table) tables.push(table);
		}
		const conflict = await checkTablesFreeForReservation(ctx, tables, {
			_id: args.excludeReservationId,
			startsAt: args.startsAt,
			endsAt,
		});
		if (conflict) return { ok: false, reason: "ERROR_NO_TABLES_AVAILABLE" };
		return { ok: true, endsAt };
	}

	const bookable = await isPartyBookableAt(
		ctx,
		restaurant._id,
		args.partySize,
		args.startsAt,
		endsAt
	);
	return bookable ? { ok: true, endsAt } : { ok: false, reason: "ERROR_NO_TABLES_AVAILABLE" };
}

/**
 * Offer to MOVE a booking — **without moving anything**.
 *
 * The same two-phase shape as `internalRequestCancel`, for the same reason: an
 * injected instruction can steer one turn's tool calls, but it cannot produce
 * the second inbound message carrying an unguessable code.
 *
 * Moving is deliberately a distinct operation rather than cancel-then-rebook.
 * Those two are not atomic over WhatsApp — the customer would send a code, lose
 * their table, and be left asking for a new one that may no longer exist.
 */
export const internalRequestReschedule = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		conversationId: v.id(TABLE.WHATSAPP_CONVERSATIONS),
		phone: v.string(),
		date: v.string(),
		time: v.string(),
		partySize: v.optional(v.number()),
		/** Which booking, when the customer has more than one upcoming. */
		currentStartsAt: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const restaurant = await ctx.db.get(args.restaurantId);
		const phone = args.phone.trim();
		if (!restaurant || !phone) return { requested: false as const, reason: "ERROR_NOT_FOUND" };

		const resolved = resolveRequestedStart({
			date: args.date,
			time: args.time,
			timezone: restaurant.timezone,
		});
		if (!resolved) return { requested: false as const, reason: "ERROR_INVALID_DATE_OR_TIME" };

		const candidates = await findUpcomingByPhone(ctx, {
			restaurantId: args.restaurantId,
			phone,
			nowMs: Date.now(),
			sources: [RESERVATION_SOURCE.WHATSAPP],
		});
		const matches =
			args.currentStartsAt === undefined
				? candidates
				: candidates.filter((r) => r.startsAt === args.currentStartsAt);

		if (matches.length === 0) return { requested: false as const, reason: "ERROR_NOT_FOUND" };
		if (matches.length > 1) {
			return {
				requested: false as const,
				reason: "ERROR_AMBIGUOUS_RESERVATION",
				options: matches.map((r) => ({
					...toLocalDateTimeParts(r.startsAt, restaurant.timezone),
					partySize: r.partySize,
				})),
			};
		}

		const reservation = matches[0];
		const partySize = args.partySize ?? reservation.partySize;
		const moveable = await evaluateMove(ctx, restaurant, {
			partySize,
			startsAt: resolved.startsAt,
			excludeReservationId: reservation._id,
			assignedTableIds: reservation.tableIds ?? [],
		});
		if (!moveable.ok) {
			// No code is minted for a move that cannot happen: a code the customer
			// can send that then fails is worse than being told now.
			return { requested: false as const, reason: moveable.reason };
		}

		const now = Date.now();
		const outstanding = await ctx.db
			.query(TABLE.WHATSAPP_PENDING_ACTIONS)
			.withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
			.collect();
		for (const row of outstanding) {
			if (row.consumedAt === undefined) await ctx.db.patch(row._id, { consumedAt: now });
		}

		const code = randomCode(WHATSAPP_CONFIRMATION_CODE_DIGITS);
		await ctx.db.insert(TABLE.WHATSAPP_PENDING_ACTIONS, {
			conversationId: args.conversationId,
			restaurantId: args.restaurantId,
			customerPhone: phone,
			kind: WHATSAPP_PENDING_ACTION.RESCHEDULE_RESERVATION,
			reservationId: reservation._id,
			newStartsAt: resolved.startsAt,
			newPartySize: partySize,
			code,
			expiresAt: now + WHATSAPP_PENDING_ACTION_TTL_MS,
			createdAt: now,
		});

		return {
			requested: true as const,
			code,
			fromStartsAt: reservation.startsAt,
			from: toLocalDateTimeParts(reservation.startsAt, restaurant.timezone),
			toStartsAt: resolved.startsAt,
			to: toLocalDateTimeParts(resolved.startsAt, restaurant.timezone),
			partySize,
		};
	},
});

/**
 * Offer a cancellation — **without cancelling anything**.
 *
 * Resolves the target from the phone-scoped index, stores it against a fresh
 * single-use code, and returns the code. The reservation is only cancelled when
 * `internalConsumeCancelCode` matches that code against a *later* inbound
 * message, which is the step no injected content can reach.
 */
export const internalRequestCancel = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		conversationId: v.id(TABLE.WHATSAPP_CONVERSATIONS),
		phone: v.string(),
		startsAt: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const restaurant = await ctx.db.get(args.restaurantId);
		const phone = args.phone.trim();
		if (!restaurant || !phone) return { requested: false as const, reason: "ERROR_NOT_FOUND" };

		const candidates = await findUpcomingByPhone(ctx, {
			restaurantId: args.restaurantId,
			phone,
			nowMs: Date.now(),
			sources: [RESERVATION_SOURCE.WHATSAPP],
		});
		const matches =
			args.startsAt === undefined
				? candidates
				: candidates.filter((r) => r.startsAt === args.startsAt);

		if (matches.length === 0) return { requested: false as const, reason: "ERROR_NOT_FOUND" };
		if (matches.length > 1) {
			return {
				requested: false as const,
				reason: "ERROR_AMBIGUOUS_RESERVATION",
				// Let the model ask which one, using only local time strings.
				options: matches.map((r) => ({
					...toLocalDateTimeParts(r.startsAt, restaurant.timezone),
					partySize: r.partySize,
				})),
			};
		}

		const reservation = matches[0];
		const now = Date.now();

		// Retire any earlier outstanding offer in this conversation, so exactly one
		// code is live at a time and an old code cannot be replayed.
		const outstanding = await ctx.db
			.query(TABLE.WHATSAPP_PENDING_ACTIONS)
			.withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
			.collect();
		for (const row of outstanding) {
			if (row.consumedAt === undefined) await ctx.db.patch(row._id, { consumedAt: now });
		}

		const code = randomCode(WHATSAPP_CONFIRMATION_CODE_DIGITS);
		await ctx.db.insert(TABLE.WHATSAPP_PENDING_ACTIONS, {
			conversationId: args.conversationId,
			restaurantId: args.restaurantId,
			customerPhone: phone,
			kind: WHATSAPP_PENDING_ACTION.CANCEL_RESERVATION,
			reservationId: reservation._id,
			code,
			expiresAt: now + WHATSAPP_PENDING_ACTION_TTL_MS,
			createdAt: now,
		});

		return {
			requested: true as const,
			code,
			startsAt: reservation.startsAt,
			...toLocalDateTimeParts(reservation.startsAt, restaurant.timezone),
			partySize: reservation.partySize,
		};
	},
});

/**
 * Redeem a confirmation code and perform the cancellation.
 *
 * Called from `processing.ts` on the raw inbound body **before** the model runs,
 * so the authorization decision is a string comparison rather than a
 * language-understanding problem. Single-use, expiring, and scoped to both the
 * conversation and the phone.
 */
export const internalConsumeCancelCode = internalMutation({
	args: {
		conversationId: v.id(TABLE.WHATSAPP_CONVERSATIONS),
		phone: v.string(),
		code: v.string(),
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		const pending = await ctx.db
			.query(TABLE.WHATSAPP_PENDING_ACTIONS)
			.withIndex("by_conversation_code", (q) =>
				q.eq("conversationId", args.conversationId).eq("code", args.code)
			)
			.first();

		if (!pending) return { cancelled: false as const, reason: "ERROR_CODE_NOT_FOUND" };
		if (pending.consumedAt !== undefined) {
			return { cancelled: false as const, reason: "ERROR_CODE_ALREADY_USED" };
		}
		if (pending.expiresAt <= now) {
			return { cancelled: false as const, reason: "ERROR_CODE_EXPIRED" };
		}
		// Belt and braces: the code was minted for this phone, so re-check rather
		// than trusting the conversation row alone.
		if (pending.customerPhone !== args.phone.trim()) {
			return { cancelled: false as const, reason: "ERROR_CODE_NOT_FOUND" };
		}

		// Burn the code before mutating, so a concurrent redemption cannot double it.
		await ctx.db.patch(pending._id, { consumedAt: now });

		const reservation = await ctx.db.get(pending.reservationId);
		if (!reservation) return { cancelled: false as const, reason: "ERROR_NOT_FOUND" };
		// Re-derive ownership on the loaded doc — never trust the stored pointer
		// alone, mirroring `requireOwnedActiveSession`.
		if (
			reservation.restaurantId !== pending.restaurantId ||
			reservation.contact.phone !== pending.customerPhone
		) {
			return { cancelled: false as const, reason: "ERROR_NOT_FOUND" };
		}
		const statusError = ensureCancellable(reservation.status, CUSTOMER_CANCELLABLE_STATUSES);
		// The customer-cancellable set doubles as "still theirs to change": a
		// seated or completed visit is the restaurant's to alter, not the guest's.
		if (statusError) return { cancelled: false as const, reason: "ERROR_NOT_CANCELLABLE" };

		if (pending.kind === WHATSAPP_PENDING_ACTION.RESCHEDULE_RESERVATION) {
			const restaurant = await ctx.db.get(pending.restaurantId);
			const newStartsAt = pending.newStartsAt;
			if (!restaurant || newStartsAt === undefined) {
				return { cancelled: false as const, reason: "ERROR_NOT_FOUND" };
			}
			const partySize = pending.newPartySize ?? reservation.partySize;

			// Re-checked at redemption, not just when the code was minted. A code
			// stays live for ten minutes and the floor can fill in that time; the
			// booking must never be moved onto a slot that no longer exists.
			const moveable = await evaluateMove(ctx, restaurant, {
				partySize,
				startsAt: newStartsAt,
				excludeReservationId: reservation._id,
				assignedTableIds: reservation.tableIds ?? [],
			});
			if (!moveable.ok) {
				return {
					rescheduled: false as const,
					kind: "reschedule" as const,
					reason: moveable.reason,
				};
			}

			await ctx.db.patch(reservation._id, {
				startsAt: newStartsAt,
				endsAt: moveable.endsAt,
				partySize,
				updatedAt: now,
				updatedBy: AUDIT_ACTOR.WHATSAPP_CUSTOMER,
			});
			await appendAuditEvent(ctx, {
				aggregateType: TABLE.RESERVATIONS,
				aggregateId: reservation._id,
				eventType: AUDIT_EVENT.RESERVATION_RESCHEDULED_BY_CUSTOMER,
				restaurantId: reservation.restaurantId,
				payload: {
					restaurantId: reservation.restaurantId,
					fromStartsAt: reservation.startsAt,
					toStartsAt: newStartsAt,
					fromPartySize: reservation.partySize,
					toPartySize: partySize,
					// The tables staff had assigned still point at the old window.
					releasedTableIds: reservation.tableIds,
					conversationId: args.conversationId,
					confirmedByCode: true,
				},
				userId: AUDIT_ACTOR.WHATSAPP_CUSTOMER,
			});

			return {
				rescheduled: true as const,
				kind: "reschedule" as const,
				startsAt: newStartsAt,
				partySize,
			};
		}

		await cancelReservationCore(ctx, {
			reservation,
			reason: CUSTOMER_CANCEL_REASON,
			userId: AUDIT_ACTOR.WHATSAPP_CUSTOMER,
			eventType: AUDIT_EVENT.RESERVATION_CANCELLED_BY_CUSTOMER,
			auditPayload: {
				conversationId: args.conversationId,
				confirmedByCode: true,
			},
		});

		return { cancelled: true as const, kind: "cancel" as const, startsAt: reservation.startsAt };
	},
});

/** Purge consumed and expired offers. Registered as a cron. */
export const purgeExpiredPendingActions = internalMutation({
	args: {},
	handler: async (ctx) => {
		const stale = await ctx.db
			.query(TABLE.WHATSAPP_PENDING_ACTIONS)
			.withIndex("by_expires", (q) => q.lt("expiresAt", Date.now()))
			.take(200);
		for (const row of stale) await ctx.db.delete(row._id);
		return { deleted: stale.length };
	},
});
