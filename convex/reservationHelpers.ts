/**
 * Internal helpers extracted from `convex/reservations.ts`.
 *
 * These are plain TypeScript functions and validators -- not Convex
 * `query`/`mutation`/`action` definitions -- so the public
 * `internal.reservations.*` paths used by HTTP routes, crons, and tests are
 * unaffected. The companion file (`reservations.ts`) retains the public API
 * surface and imports the helpers below for shared logic.
 *
 * Mirrors the precedent in `convex/stripeHelpers.ts`.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import {
	ConflictError,
	ConflictErrorObject,
	NotFoundError,
	NotFoundErrorObject,
	RateLimitedError,
	RateLimitedErrorObject,
	UserInputValidationError,
	UserInputValidationErrorObject,
} from "./_shared/errors";
import { AsyncReturn } from "./_shared/types";
import { loadPlacementWindow, placeParty, symmetricCandidateTimes } from "./_util/tablePlacement";
import {
	computeEndsAt,
	computeTurnMinutes,
	findOverlappingLocks,
	findOverlappingReservations,
	intersectsBlackout,
	isWithinHorizon,
	isWithinOperatingHours,
	resolveServiceWindow,
} from "./_util/availability";
import { isReservationsEnabled } from "./featureFlags";
import { normalizeContactPhone } from "./_util/phone";
import { appendAuditEvent } from "./_util/audit";
import { consumeRateLimit, type RateLimitConfig } from "./_util/rateLimit";
import { loadEffectiveSettings } from "./_util/reservationSettings";
import {
	AUDIT_EVENT,
	AUDIT_SYSTEM_USER_ID,
	RESERVATION_SOURCE,
	RESERVATION_STATUS,
	TABLE_ASSIGNED_BY,
	ReservationStatus,
	TABLE,
} from "./constants";

type ReservationDoc = Doc<typeof TABLE.RESERVATIONS>;

/** Minimum reservation length; matches the 15-minute timeline snap grid. */
export const MIN_RESERVATION_DURATION_MS = 15 * 60_000;

// Abuse-control bounds for the public (unauthenticated) create surface.
export const MAX_PARTY_SIZE = 50;
export const MAX_CONTACT_NAME_LENGTH = 120;
export const MAX_PHONE_LENGTH = 32;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_NOTES_LENGTH = 1000;
/** Loose shape check only — deliverability is verified via confirmation email. */
export const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Max reservations per phone number per restaurant within the window. */
export const RESERVATION_RATE_LIMIT_MAX = 5;
export const RESERVATION_RATE_LIMIT_WINDOW_MS = 60 * 60_000;

// Attempt-based sliding-window limits for the create surface. Unlike
// `assertReservationCreateNotRateLimited` -- which caps how many rows a single
// phone can actually *book* -- these bound how many create *attempts* (including
// ones that fail availability) an identity can make, so a flood of cheap
// requests can't drive the expensive per-table availability scans. Keyed per
// restaurant + contact identity (phone, and email when present).
export const RESERVATION_CREATE_ATTEMPT_LIMIT: RateLimitConfig = {
	windowMs: 60 * 60_000,
	max: 10,
};
/** Bot (WhatsApp) creates are token-guarded and trusted, so give them headroom. */
export const RESERVATION_CREATE_ATTEMPT_LIMIT_BOT: RateLimitConfig = {
	windowMs: 60 * 60_000,
	max: 200,
};

/**
 * Rate-limit config for a create attempt by source. Staff creates are
 * authenticated and never throttled (returns `null`).
 */
export function attemptLimitForSource(source: CreateCoreArgs["source"]): RateLimitConfig | null {
	switch (source) {
		case RESERVATION_SOURCE.WHATSAPP:
			return RESERVATION_CREATE_ATTEMPT_LIMIT_BOT;
		case RESERVATION_SOURCE.UI:
			return RESERVATION_CREATE_ATTEMPT_LIMIT;
		default:
			return null;
	}
}

/**
 * Rate-limit keys for a create attempt: one per contact identity, each scoped to
 * the restaurant. Phone is always present; email is added only when supplied.
 */
export function reservationCreateRateLimitKeys(
	restaurantId: Id<typeof TABLE.RESTAURANTS>,
	contact: { phone: string; email?: string }
): string[] {
	const keys: string[] = [];
	const phone = contact.phone.trim();
	if (phone) keys.push(`reservation_create:${restaurantId}:phone:${phone}`);
	const email = contact.email?.trim().toLowerCase();
	if (email) keys.push(`reservation_create:${restaurantId}:email:${email}`);
	return keys;
}

// ----------------------------------------------------------------------------
// Availability query bounds (anonymous, unthrottled read surface)
// ----------------------------------------------------------------------------

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/**
 * True when `partySize` could ever be seated: a positive integer within the
 * public party-size cap. Lets the anonymous availability queries short-circuit
 * out-of-range inputs before running any table/reservation/lock scan -- a party
 * of 0 or 5000 has no tables by definition, so the result is unchanged.
 */
export function isBookablePartySize(partySize: number): boolean {
	return Number.isInteger(partySize) && partySize >= 1 && partySize <= MAX_PARTY_SIZE;
}

/**
 * True when the local calendar window `[fromMs, toMs)` could contain at least
 * one slot inside the booking horizon `[now + minAdvance, now + maxAdvance]`.
 * When false, every candidate slot is out of horizon, so the slot loop can be
 * skipped entirely. Conservative: it uses `toMs` (an upper bound on any slot
 * start) so it never skips a window that might still hold a valid slot -- the
 * returned slots are therefore unchanged.
 */
export function windowIntersectsHorizon(params: {
	fromMs: number;
	toMs: number;
	now: number;
	minAdvanceMinutes: number;
	maxAdvanceDays: number;
}): boolean {
	const { fromMs, toMs, now, minAdvanceMinutes, maxAdvanceDays } = params;
	const earliest = now + minAdvanceMinutes * MS_PER_MINUTE;
	const latest = now + maxAdvanceDays * MS_PER_DAY;
	return toMs >= earliest && fromMs <= latest;
}

export function validateReservationWindow(
	startsAt: number,
	endsAt: number
): UserInputValidationErrorObject | null {
	if (endsAt <= startsAt) {
		return new UserInputValidationError({
			fields: [{ field: "endsAt", message: "End time must be after start time" }],
		}).toObject();
	}
	if (endsAt - startsAt < MIN_RESERVATION_DURATION_MS) {
		return new UserInputValidationError({
			fields: [
				{
					field: "endsAt",
					message: "Reservation must be at least 15 minutes long",
				},
			],
		}).toObject();
	}
	return null;
}

/**
 * Resolve the booking window after a reschedule. When only `startsAt` changes,
 * preserve the existing duration so staff overrides and timeline drags keep
 * custom lengths.
 */
export function resolveRescheduleWindow(
	reservation: Pick<ReservationDoc, "startsAt" | "endsAt">,
	args: { startsAt?: number; endsAt?: number }
): { startsAt: number; endsAt: number } {
	const startsAt = args.startsAt ?? reservation.startsAt;
	if (args.endsAt !== undefined) {
		return { startsAt, endsAt: args.endsAt };
	}
	if (args.startsAt !== undefined) {
		const durationMs = reservation.endsAt - reservation.startsAt;
		return { startsAt, endsAt: startsAt + durationMs };
	}
	return { startsAt: reservation.startsAt, endsAt: reservation.endsAt };
}

export type CreateErrors =
	| NotFoundErrorObject
	| UserInputValidationErrorObject
	| ConflictErrorObject
	| RateLimitedErrorObject;

export type CreateCoreArgs = {
	restaurantId: Id<typeof TABLE.RESTAURANTS>;
	partySize: number;
	startsAt: number;
	contact: { name: string; phone: string; email?: string };
	source: (typeof RESERVATION_SOURCE)[keyof typeof RESERVATION_SOURCE];
	userId?: string;
	notes?: string;
	idempotencyKey?: string;
	/**
	 * Staff-only escape: clear the capacity check but take no table, sending the
	 * row to the unassigned queue for a human to place. Customer-facing paths
	 * never set this -- a booking nobody has a table for is the bug this whole
	 * change exists to remove.
	 */
	leaveUnassigned?: boolean;
};

// Create runs inside a mutation: it inserts the reservation row and (via the
// rate limiter) reads/writes the `rateLimits` table, so it needs a full writer.
type CreateCoreCtx = {
	db: DatabaseWriter;
};

export const contactValidator = v.object({
	name: v.string(),
	phone: v.string(),
	email: v.optional(v.string()),
});

export const sourceValidator = v.union(
	v.literal(RESERVATION_SOURCE.UI),
	v.literal(RESERVATION_SOURCE.WHATSAPP),
	v.literal(RESERVATION_SOURCE.STAFF)
);

/**
 * True if the party can be seated at [startsAt, endsAt) using one or more
 * active tables (same rules as the public availability query).
 */
/**
 * Can this party be seated in this window?
 *
 * Delegates to `placeParty` rather than reimplementing the search. That is the
 * whole point: this predicate answers the customer ("is 20:00 free?") while
 * `createReservationCore` answers the booking, and if the two ever disagreed the
 * assistant would promise a table that booking then refuses — the customer hears
 * the slot vanished mid-sentence.
 */
export async function isPartyBookableAt(
	ctx: { db: DatabaseReader },
	restaurantId: Id<typeof TABLE.RESTAURANTS>,
	partySize: number,
	startsAt: number,
	endsAt: number
): Promise<boolean> {
	const window = await loadPlacementWindow(ctx, restaurantId, startsAt, endsAt);
	return placeParty({ ...window, partySize, startsAt, endsAt }) !== null;
}

/** How many alternatives we ever return. Keeps the reply short. */
export const MAX_SUGGESTED_TIMES = 3;
/** Half-hour granularity, three hours out in each direction. */
const SUGGESTION_STEP_MS = 30 * 60_000;
const SUGGESTION_MAX_STEPS = 6;

/**
 * Times near `startsAt` that this party could actually be seated at.
 *
 * Searches **outward in both directions**, nearest first. It used to walk
 * forward only, so a customer asking for 20:00 with 19:30 free was offered
 * 21:30 and gave up -- half of "close to the time you asked for" was
 * unreachable.
 *
 * Going backwards is what makes the gates below mandatory rather than nice to
 * have: forward-only drift stays inside service, but searching earlier runs
 * straight into opening time and the minimum-advance window. A suggestion the
 * customer cannot book is worse than no suggestion.
 *
 * All candidates share **one** windowed read. Twelve probes through the old
 * per-table helpers would have issued twelve full scans of every table.
 */
export async function findSuggestedTimes(
	ctx: { db: DatabaseReader },
	params: {
		restaurant: Doc<typeof TABLE.RESTAURANTS>;
		settings: Pick<
			Doc<typeof TABLE.RESERVATION_SETTINGS>,
			"minAdvanceMinutes" | "maxAdvanceDays" | "blackoutWindows"
		>;
		partySize: number;
		startsAt: number;
		turnMinutes: number;
	}
): Promise<number[]> {
	const candidates = symmetricCandidateTimes(
		params.startsAt,
		SUGGESTION_STEP_MS,
		SUGGESTION_MAX_STEPS
	);
	if (candidates.length === 0) return [];

	const earliest = Math.min(...candidates);
	const latest = Math.max(...candidates) + params.turnMinutes * 60_000;
	const window = await loadPlacementWindow(ctx, params.restaurant._id, earliest, latest);
	const serviceWindow = resolveServiceWindow(params.restaurant);
	const now = Date.now();

	const suggestions: number[] = [];
	for (const candidate of candidates) {
		if (suggestions.length >= MAX_SUGGESTED_TIMES) break;
		const candidateEnd = computeEndsAt(candidate, params.turnMinutes);

		if (
			!isWithinHorizon({
				minAdvanceMinutes: params.settings.minAdvanceMinutes,
				maxAdvanceDays: params.settings.maxAdvanceDays,
				startsAt: candidate,
				now,
			})
		) {
			continue;
		}
		if (intersectsBlackout(params.settings, candidate, candidateEnd)) continue;
		if (
			!isWithinOperatingHours({
				startsAt: candidate,
				endsAt: candidateEnd,
				window: serviceWindow,
			})
		) {
			continue;
		}

		const placement = placeParty({
			...window,
			partySize: params.partySize,
			startsAt: candidate,
			endsAt: candidateEnd,
		});
		if (placement !== null) suggestions.push(candidate);
	}

	return suggestions;
}

export function validateCreateInputs(args: CreateCoreArgs): UserInputValidationErrorObject | null {
	if (!Number.isInteger(args.partySize) || args.partySize < 1 || args.partySize > MAX_PARTY_SIZE) {
		return new UserInputValidationError({
			fields: [{ field: "partySize", message: "ERROR_INVALID_PARTY_SIZE" }],
		}).toObject();
	}

	const name = args.contact.name.trim();
	const phone = args.contact.phone.trim();
	if (!name || !phone) {
		return new UserInputValidationError({
			fields: [
				{ field: "contact.name", message: "Required" },
				{ field: "contact.phone", message: "Required" },
			],
		}).toObject();
	}
	if (name.length > MAX_CONTACT_NAME_LENGTH || phone.length > MAX_PHONE_LENGTH) {
		return new UserInputValidationError({
			fields: [{ field: "contact", message: "ERROR_CONTACT_FIELD_TOO_LONG" }],
		}).toObject();
	}

	const email = args.contact.email?.trim();
	if (email) {
		if (email.length > MAX_EMAIL_LENGTH || !BASIC_EMAIL_PATTERN.test(email)) {
			return new UserInputValidationError({
				fields: [{ field: "contact.email", message: "ERROR_INVALID_EMAIL" }],
			}).toObject();
		}
	}

	if (args.notes && args.notes.length > MAX_NOTES_LENGTH) {
		return new UserInputValidationError({
			fields: [{ field: "notes", message: "ERROR_NOTES_TOO_LONG" }],
		}).toObject();
	}

	return null;
}

async function assertReservationCreateNotRateLimited(
	ctx: CreateCoreCtx,
	restaurantId: Id<typeof TABLE.RESTAURANTS>,
	phone: string
): Promise<ConflictErrorObject | null> {
	const since = Date.now() - RESERVATION_RATE_LIMIT_WINDOW_MS;
	const recent = await ctx.db
		.query(TABLE.RESERVATIONS)
		.withIndex("by_phone", (q) => q.eq("restaurantId", restaurantId).eq("contact.phone", phone))
		.collect();
	const count = recent.filter((row) => row.createdAt >= since).length;
	if (count >= RESERVATION_RATE_LIMIT_MAX) {
		return new ConflictError("ERROR_RESERVATION_RATE_LIMITED").toObject();
	}
	return null;
}

/**
 * Sliding-window attempt limiter for the create surface. Consumes budget for
 * each contact identity (per restaurant). Trips on the first over-cap identity.
 * Staff creates are exempt (config is `null`).
 */
async function assertReservationCreateWithinAttemptLimit(
	ctx: CreateCoreCtx,
	args: CreateCoreArgs
): Promise<RateLimitedErrorObject | null> {
	const config = attemptLimitForSource(args.source);
	if (!config) return null;
	const now = Date.now();
	const keys = reservationCreateRateLimitKeys(args.restaurantId, args.contact);
	for (const key of keys) {
		const decision = await consumeRateLimit(ctx, key, config, now);
		if (!decision.allowed) return new RateLimitedError().toObject();
	}
	return null;
}

/**
 * Shared create logic. Validates, runs all gates, then inserts a `pending`
 * row with no tableIds.
 */
export async function createReservationCore(
	ctx: CreateCoreCtx,
	args: CreateCoreArgs
): AsyncReturn<Id<typeof TABLE.RESERVATIONS>, CreateErrors> {
	const inputError = validateCreateInputs(args);
	if (inputError) return [null, inputError];

	const restaurant = await ctx.db.get(args.restaurantId);
	if (!restaurant) {
		return [null, new NotFoundError("Restaurant not found").toObject()];
	}

	// Canonicalized once, here, because this is the single write path every
	// source funnels through — staff, the public form, the reservations bot API
	// and the WhatsApp assistant. `contact.phone` is the customer's whole
	// identity (ADR-011) and is matched by exact index lookup, so a number stored
	// as typed makes the same human several unrelated customers. Everything below
	// reads `contact`, never `args.contact`, so the rate-limit keys are keyed on
	// the identity rather than on how it happened to be punctuated.
	const contact = {
		...args.contact,
		phone: normalizeContactPhone(args.contact.phone, restaurant.timezone),
	};
	const normalizedArgs = { ...args, contact };

	const rateLimitError = await assertReservationCreateNotRateLimited(
		ctx,
		args.restaurantId,
		contact.phone
	);
	if (rateLimitError) return [null, rateLimitError];

	if (args.idempotencyKey) {
		const existing = await ctx.db
			.query(TABLE.RESERVATIONS)
			.withIndex("by_restaurant_idempotency", (q) =>
				q.eq("restaurantId", args.restaurantId).eq("idempotencyKey", args.idempotencyKey)
			)
			.first();
		if (existing) return [existing._id, null];
	}

	// Attempt limiter -- gate the expensive availability scans below. Runs after
	// the idempotency short-circuit so safe retries don't burn budget.
	const attemptLimitError = await assertReservationCreateWithinAttemptLimit(ctx, normalizedArgs);
	if (attemptLimitError) return [null, attemptLimitError];

	// The platform switch comes first, and it applies to every diner-facing
	// source (TAVLI-100). A UI gate on an anonymous page is not a gate: the
	// mutation name is in the client bundle, so hiding the Reserve tab stops
	// navigation and nothing else.
	//
	// Staff-created bookings are deliberately exempt — see `createAsStaff`.
	// Switching the product's reservations off must not stop a manager writing
	// down the party standing in front of them.
	if (args.source !== RESERVATION_SOURCE.STAFF && !(await isReservationsEnabled(ctx))) {
		return [null, new ConflictError("ERROR_NOT_ACCEPTING_RESERVATIONS").toObject()];
	}

	const settings = await loadEffectiveSettings(ctx, args.restaurantId);
	if (!settings.acceptingReservations) {
		return [null, new ConflictError("ERROR_NOT_ACCEPTING_RESERVATIONS").toObject()];
	}

	const turnMinutes = computeTurnMinutes(settings, args.partySize);
	const endsAt = computeEndsAt(args.startsAt, turnMinutes);
	const now = Date.now();
	const isWhatsapp = args.source === RESERVATION_SOURCE.WHATSAPP;
	const minAdvanceMinutes = isWhatsapp ? settings.minAdvanceMinutes : 0;

	if (
		!isWithinHorizon({
			minAdvanceMinutes,
			maxAdvanceDays: settings.maxAdvanceDays,
			startsAt: args.startsAt,
			now,
		})
	) {
		return [null, new ConflictError("ERROR_OUTSIDE_BOOKING_HORIZON").toObject()];
	}
	if (intersectsBlackout(settings, args.startsAt, endsAt)) {
		return [null, new ConflictError("ERROR_BLACKOUT_WINDOW").toObject()];
	}
	// Staff keep the override so they can take private-event and after-hours
	// bookings; customers and the assistant cannot. Mirrors the source-aware
	// `minAdvanceMinutes` decision above.
	if (
		args.source !== RESERVATION_SOURCE.STAFF &&
		!isWithinOperatingHours({
			startsAt: args.startsAt,
			endsAt,
			window: resolveServiceWindow(restaurant),
		})
	) {
		return [null, new ConflictError("ERROR_OUTSIDE_OPERATING_HOURS").toObject()];
	}

	// Admission IS placement. Asking `placeParty` for actual tables, rather than
	// asking a separate function whether tables *could* exist, is what makes
	// "admitted but unplaceable" impossible: if this returns a selection, those
	// are the tables the row is created on.
	//
	// The one exception is a staff member who explicitly defers the choice. That
	// row still has to clear the capacity check -- it just goes to the queue with
	// no tables rather than taking a specific one.
	const window = await loadPlacementWindow(ctx, args.restaurantId, args.startsAt, endsAt);
	const placement = placeParty({
		...window,
		partySize: args.partySize,
		startsAt: args.startsAt,
		endsAt,
	});
	if (placement === null) {
		return [null, new ConflictError("ERROR_NO_TABLES_AVAILABLE").toObject()];
	}

	const assigned = args.leaveUnassigned ? [] : placement;

	const id = await ctx.db.insert(TABLE.RESERVATIONS, {
		restaurantId: args.restaurantId,
		partySize: args.partySize,
		startsAt: args.startsAt,
		endsAt,
		tableIds: assigned.map((t) => t._id),
		...(assigned.length > 0 && { tableAssignedBy: TABLE_ASSIGNED_BY.AUTO }),
		status: RESERVATION_STATUS.PENDING,
		source: args.source,
		contact,
		userId: args.userId,
		notes: args.notes,
		idempotencyKey: args.idempotencyKey,
		createdAt: now,
		updatedAt: now,
	});

	// Deliberately here rather than in the three callers (UI `create`, staff
	// `createAsStaff`, bot `internalCreate`): this is the single point where a
	// reservation row actually comes into existence, and the idempotency
	// short-circuit above returns before it, so a replayed bot request does not
	// log a second creation.
	await appendAuditEvent(ctx, {
		aggregateType: TABLE.RESERVATIONS,
		aggregateId: id,
		eventType: AUDIT_EVENT.RESERVATION_CREATED,
		restaurantId: args.restaurantId,
		payload: {
			restaurantId: args.restaurantId,
			partySize: args.partySize,
			startsAt: args.startsAt,
			endsAt,
			source: args.source,
		},
		userId: args.userId ?? AUDIT_SYSTEM_USER_ID,
		idempotencyKey: args.idempotencyKey,
	});

	return [id, null];
}

export function ensureConfirmable(
	status: ReservationStatus
): UserInputValidationErrorObject | null {
	if (status === RESERVATION_STATUS.PENDING) return null;
	return new UserInputValidationError({
		fields: [{ field: "status", message: `Cannot confirm a reservation in status ${status}` }],
	}).toObject();
}

// ============================================================================
// Cancellation
// ============================================================================

/**
 * Statuses staff may not cancel out of. Both are terminal-but-recoverable and
 * are reopened via `reconfirm` instead.
 *
 * `completed` is deliberately absent: a completed reservation still occupies its
 * table window (it is in `ACTIVE_RESERVATION_STATUSES`), so staff who marked the
 * wrong booking completed need a way to take it out of the floor plan.
 */
export const STAFF_NON_CANCELLABLE_STATUSES: ReservationStatus[] = [
	RESERVATION_STATUS.CANCELLED,
	RESERVATION_STATUS.NO_SHOW,
];

/**
 * Statuses a *customer* may cancel from, deliberately narrower than staff's
 * rule. A `seated` guest is physically at the table, so releasing it from their
 * phone would desync the floor from the system; staff handle that case.
 */
export const CUSTOMER_CANCELLABLE_STATUSES: ReservationStatus[] = [
	RESERVATION_STATUS.PENDING,
	RESERVATION_STATUS.CONFIRMED,
];

export function ensureCancellable(
	status: ReservationStatus,
	allowedStatuses?: ReservationStatus[]
): UserInputValidationErrorObject | null {
	const permitted = allowedStatuses
		? allowedStatuses.includes(status)
		: !STAFF_NON_CANCELLABLE_STATUSES.includes(status);
	if (permitted) return null;
	return new UserInputValidationError({
		fields: [{ field: "status", message: `Cannot cancel a reservation in status ${status}` }],
	}).toObject();
}

/**
 * Apply the cancellation and write its audit event.
 *
 * Shared by the staff mutation and the customer (WhatsApp) path so the state
 * transition is written in exactly one place. Callers differ only in who they
 * authorize and what they record as the actor — never in what they patch.
 */
export async function cancelReservationCore(
	ctx: CreateCoreCtx,
	args: {
		reservation: ReservationDoc;
		reason?: string;
		userId: string;
		eventType: string;
		/** Extra audit payload fields (e.g. WhatsApp conversation pointers). */
		auditPayload?: Record<string, unknown>;
	}
): Promise<Id<typeof TABLE.RESERVATIONS>> {
	const now = Date.now();
	await ctx.db.patch(args.reservation._id, {
		status: RESERVATION_STATUS.CANCELLED,
		cancelledAt: now,
		cancelReason: args.reason,
		updatedAt: now,
		updatedBy: args.userId,
	});

	await appendAuditEvent(ctx, {
		aggregateType: TABLE.RESERVATIONS,
		aggregateId: args.reservation._id,
		eventType: args.eventType,
		// Indexed (`by_restaurant_time`) so a cancelled booking still shows up in
		// the restaurant's history — the payload copy below is not queryable.
		restaurantId: args.reservation.restaurantId,
		payload: {
			restaurantId: args.reservation.restaurantId,
			fromStatus: args.reservation.status,
			startsAt: args.reservation.startsAt,
			partySize: args.reservation.partySize,
			reason: args.reason,
			// Kept so a released table is traceable after the fact — cancelling a
			// confirmed booking frees whatever staff had assigned.
			releasedTableIds: args.reservation.tableIds,
			...args.auditPayload,
		},
		userId: args.userId,
	});

	return args.reservation._id;
}

/** Upper bound on how many of a customer's own bookings we ever consider. */
export const CUSTOMER_RESERVATION_LOOKUP_LIMIT = 5;

/**
 * A customer's own upcoming, cancellable reservations at one restaurant.
 *
 * This is THE ownership boundary for the customer-facing cancel path, and the
 * reason it is a single named helper: the scope must be an index equality on
 * `(restaurantId, contact.phone)`, never a post-hoc filter over a wider read.
 * Modelled on `requireOwnedActiveSession` in `_util/dinerSession.ts`.
 *
 * `source` is restricted by the caller. Phone numbers are not a reliable
 * identity on staff-entered rows (walk-in placeholders, hotel and concierge
 * numbers used for many guests, "booked under my partner's number"), so
 * widening beyond bot-created rows would turn phone equality into a
 * multi-tenant key.
 */
export async function findUpcomingByPhone(
	ctx: { db: DatabaseReader },
	args: {
		restaurantId: Id<typeof TABLE.RESTAURANTS>;
		phone: string;
		nowMs: number;
		sources?: CreateCoreArgs["source"][];
	}
): Promise<ReservationDoc[]> {
	// Canonicalized on the way in as well as on the way out: a caller holding a
	// number in any other spelling would otherwise miss its own stored row.
	const restaurant = await ctx.db.get(args.restaurantId);
	const phone = normalizeContactPhone(args.phone, restaurant?.timezone);

	const rows = await ctx.db
		.query(TABLE.RESERVATIONS)
		.withIndex("by_phone", (q) =>
			q.eq("restaurantId", args.restaurantId).eq("contact.phone", phone)
		)
		.collect();

	return rows
		.filter((r) => CUSTOMER_CANCELLABLE_STATUSES.includes(r.status))
		.filter((r) => r.startsAt > args.nowMs)
		.filter((r) => !args.sources || args.sources.includes(r.source))
		.sort((a, b) => a.startsAt - b.startsAt)
		.slice(0, CUSTOMER_RESERVATION_LOOKUP_LIMIT);
}

const NON_RESCHEDULABLE_STATUSES: ReservationStatus[] = [
	RESERVATION_STATUS.CANCELLED,
	RESERVATION_STATUS.NO_SHOW,
];

/**
 * Whether the forward-looking booking horizon applies to a reschedule.
 *
 * A `completed` visit already happened, so its `startsAt` is always in the
 * past and `isWithinHorizon` would reject *every* correction to it. Staff
 * fixing a mistyped duration after service are not making a booking, so the
 * horizon does not apply. Window length, the 15-minute minimum, blackout
 * windows, table capacity and the double-booking check all still run.
 */
export function enforcesBookingHorizon(status: ReservationStatus): boolean {
	return status !== RESERVATION_STATUS.COMPLETED;
}

export const TERMINAL_RECOVERABLE_STATUSES: ReservationStatus[] = [
	RESERVATION_STATUS.CANCELLED,
	RESERVATION_STATUS.NO_SHOW,
];

export function isTerminalRecoverable(status: ReservationStatus): boolean {
	return TERMINAL_RECOVERABLE_STATUSES.includes(status);
}

export function ensureTerminalRecoverable(
	status: ReservationStatus
): UserInputValidationErrorObject | null {
	if (isTerminalRecoverable(status)) return null;
	return new UserInputValidationError({
		fields: [
			{
				field: "status",
				message: `Cannot reopen a reservation in status ${status}`,
			},
		],
	}).toObject();
}

/** Fields applied when moving cancelled / no_show back into the active lifecycle. */
export function buildReopenToConfirmedPatch(
	reservation: Pick<ReservationDoc, "confirmedAt">,
	now: number
) {
	return {
		status: RESERVATION_STATUS.CONFIRMED,
		confirmedAt: reservation.confirmedAt ?? now,
		cancelledAt: undefined,
		cancelReason: undefined,
		updatedAt: now,
	};
}

export function ensureReschedulable(
	status: ReservationStatus
): UserInputValidationErrorObject | null {
	if (!NON_RESCHEDULABLE_STATUSES.includes(status)) return null;
	return new UserInputValidationError({
		fields: [{ field: "status", message: `Cannot reschedule a reservation in status ${status}` }],
	}).toObject();
}

/**
 * Per-block table move: remove `fromTableId` (if present in the list), then append
 * `toTableId` when provided. `toTableId: null` means drop on the unassigned row
 * (removal only).
 */
export function applyPerBlockTableMove(
	tableIds: Id<typeof TABLE.TABLES>[],
	fromTableId: Id<typeof TABLE.TABLES> | undefined,
	toTableId: Id<typeof TABLE.TABLES> | null | undefined
): Id<typeof TABLE.TABLES>[] {
	let next = [...tableIds];
	if (fromTableId !== undefined) {
		next = next.filter((id) => id !== fromTableId);
	}
	if (toTableId !== undefined && toTableId !== null && !next.includes(toTableId)) {
		next.push(toTableId);
	}
	return next;
}

export function validateTableSelection(
	tableIds: Id<typeof TABLE.TABLES>[]
): UserInputValidationErrorObject | null {
	if (tableIds.length === 0) {
		return new UserInputValidationError({
			fields: [{ field: "tableIds", message: "Pick at least one table" }],
		}).toObject();
	}
	if (new Set(tableIds).size !== tableIds.length) {
		return new UserInputValidationError({
			fields: [{ field: "tableIds", message: "Duplicate tables in selection" }],
		}).toObject();
	}
	return null;
}

export async function loadAndValidateTables(
	ctx: { db: { get: (id: Id<typeof TABLE.TABLES>) => Promise<Doc<typeof TABLE.TABLES> | null> } },
	tableIds: Id<typeof TABLE.TABLES>[],
	restaurantId: Id<typeof TABLE.RESTAURANTS>
): Promise<[Doc<typeof TABLE.TABLES>[], null] | [null, UserInputValidationErrorObject]> {
	const loaded: Doc<typeof TABLE.TABLES>[] = [];
	for (let i = 0; i < tableIds.length; i++) {
		const t = await ctx.db.get(tableIds[i]);
		if (!t || !t.isActive || t.restaurantId !== restaurantId) {
			return [
				null,
				new UserInputValidationError({
					fields: [{ field: `tableIds[${i}]`, message: "Invalid table" }],
				}).toObject(),
			];
		}
		loaded.push(t);
	}
	return [loaded, null];
}

export async function checkTablesFreeForReservation(
	ctx: Parameters<typeof findOverlappingReservations>[0],
	tables: Doc<typeof TABLE.TABLES>[],
	reservation: Pick<ReservationDoc, "_id" | "startsAt" | "endsAt">
): Promise<ConflictErrorObject | null> {
	for (const t of tables) {
		const conflicts = await findOverlappingReservations(
			ctx,
			t._id,
			reservation.startsAt,
			reservation.endsAt,
			{ excludeReservationId: reservation._id }
		);
		if (conflicts.length > 0) {
			return new ConflictError("ERROR_TABLE_UNAVAILABLE").toObject();
		}
		const locks = await findOverlappingLocks(ctx, t._id, reservation.startsAt, reservation.endsAt);
		if (locks.length > 0) {
			return new ConflictError("ERROR_TABLE_LOCKED").toObject();
		}
	}
	return null;
}
