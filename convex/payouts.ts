/**
 * Payouts: the restaurant's own money leaving Stripe (TAVLI-103).
 *
 * Stripe pays a connected account's balance out to the restaurant's bank on a
 * schedule. When one of those payouts fails — wrong CLABE, closed account,
 * lapsed verification, restricted account — Stripe emits `payout.failed` and
 * usually pauses the schedule. **Nothing is lost**: the money sits in the
 * connected account's balance until the bank details are fixed. Until this
 * ticket there was no `payout.*` handler anywhere, so neither Tavli nor the
 * restaurant ever found out; a restaurant could go weeks wondering where its
 * takings were.
 *
 * This module is the persistence and the telling:
 *
 * - `recordPayoutEventInternal` upserts one row per Stripe payout id, and on a
 *   transition **into** `failed` tells the restaurant's managers (bell + email)
 *   and raises a severe operator alert. That includes a payout that already
 *   showed `paid` and was then returned by the bank (`paid` → `failed`), which
 *   takes exactly the same path. On the payout that clears the last
 *   unresolved failure it tells them payouts have resumed.
 * - `listByRestaurant` and `getHeldTotal` are what the payouts page and the
 *   payments-page banner read, both gated on `requireRestaurantManagerOrAbove`.
 *
 * Two boundaries are deliberate and load-bearing:
 *
 * 1. **`failureMessage` never leaves the backend.** It is Stripe's raw English
 *    sentence, stored for whoever is looking at the Stripe Dashboard beside it.
 *    The manager-facing rows carry a normalized `failureCode` from the closed
 *    set in `PAYOUT_FAILURE_CODE`, which the UI renders as bilingual copy.
 * 2. **The side effects fire on the transition, not on the event.** Event-id
 *    dedup in `stripeWebhookEvents` stops a redelivery; this stops a *different*
 *    event about the same already-failed payout (a following `payout.updated`)
 *    from ringing the bell twice. Both notification and alert also pass a
 *    `dedupeKey` per payout id, so three layers have to fail before a manager
 *    gets a duplicate.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, query } from "./_generated/server";
import type {
	NotAuthenticatedErrorObject,
	NotAuthorizedErrorObject,
	NotFoundErrorObject,
} from "./_shared/errors";
import type { AsyncReturn } from "./_shared/types";
import { getCurrentUserId, requireRestaurantManagerOrAbove } from "./_util/auth";
import { listRestaurantManagerEmails, notifyRestaurantManagers } from "./_util/notifications";
import { raiseOperatorAlert } from "./_util/operatorAlerts";
import {
	NOTIFICATION_KIND,
	OPERATOR_ALERT_KIND,
	OPERATOR_ALERT_SEVERITY,
	PAYOUT_FAILURE_CODE,
	PAYOUTS_PAGE_PATH,
	STRIPE_PAYOUT_STATUS,
	STRIPE_PAYOUT_STATUSES,
	TABLE,
	type PayoutFailureCode,
	type StripePayoutStatus,
} from "./constants";
import {
	computeHeldTotal,
	decidePayoutUpdate,
	formatPayoutAmount,
	heldTotalPaidLowerBound,
	isPayoutReturn,
	normalizePayoutFailureCode,
	type HeldTotal,
	type HeldTotalInput,
} from "./payoutHelpers";

type PayoutDoc = Doc<typeof TABLE.STRIPE_PAYOUTS>;
type PayoutReadCtx = QueryCtx | MutationCtx;

/** i18n keys for the amount-bearing notification bodies (the defaults take no params). */
export const PAYOUT_NOTIFICATION_KEY = {
	FAILED: "payouts.notification.failed",
	RESUMED: "payouts.notification.resumed",
} as const;

/** Validator for the stored status enum, so an action cannot invent one. */
const statusValidator = v.union(...STRIPE_PAYOUT_STATUSES.map((status) => v.literal(status)));

// ============================================================================
// Reading the held total
// ============================================================================

/** A held-total input plus the payout's own currency, for labelling the total. */
type HeldTotalRow = HeldTotalInput & { currency: string };

/**
 * The failed payouts of one restaurant, plus every successful payout that could
 * possibly supersede one.
 *
 * Both reads are indexed on `by_restaurant_status_created`. The failed set is
 * naturally tiny. The successful set is bounded to payouts created **after the
 * newest failure** (after its return, for a payout that went `paid` →
 * `failed` — `heldTotalPaidLowerBound`): a `paid` older than that cannot
 * resolve anything, because the newest failure itself supersedes every failure
 * before it (see `computeHeldTotal`). So a restaurant with a clean history
 * reads one empty range and stops, and even a restaurant with an ancient
 * unresolved failure reads only what came after its most recent bounce.
 */
async function readHeldTotalInputs(
	ctx: PayoutReadCtx,
	restaurantId: Id<"restaurants">
): Promise<HeldTotalRow[]> {
	const failures = await ctx.db
		.query(TABLE.STRIPE_PAYOUTS)
		.withIndex("by_restaurant_status_created", (q) =>
			q.eq("restaurantId", restaurantId).eq("status", STRIPE_PAYOUT_STATUS.FAILED)
		)
		.collect();
	if (failures.length === 0) return [];

	const toRow = (row: PayoutDoc): HeldTotalRow => ({
		stripePayoutId: row.stripePayoutId,
		amount: row.amount,
		createdAt: row.createdAt,
		status: row.status as StripePayoutStatus,
		currency: row.currency,
		...(row.returnedAt !== undefined && { returnedAt: row.returnedAt }),
	});
	const failureRows = failures.map(toRow);

	const paidAfter = heldTotalPaidLowerBound(failureRows);
	if (paidAfter === null) return failureRows;
	const successes = await ctx.db
		.query(TABLE.STRIPE_PAYOUTS)
		.withIndex("by_restaurant_status_created", (q) =>
			q
				.eq("restaurantId", restaurantId)
				.eq("status", STRIPE_PAYOUT_STATUS.PAID)
				.gt("createdAt", paidAfter)
		)
		.collect();

	return [...failureRows, ...successes.map(toRow)];
}

/** The held total for one restaurant, plus the currency to render it in. */
export type RestaurantHeldTotal = HeldTotal & {
	/**
	 * Currency of the held payouts. Falls back to the Restaurant's own currency
	 * when nothing is held, so the caller always has something to render.
	 */
	currency: string;
};

async function readHeldTotal(
	ctx: PayoutReadCtx,
	restaurant: Doc<"restaurants">
): Promise<RestaurantHeldTotal> {
	const rows = await readHeldTotalInputs(ctx, restaurant._id);
	const held = computeHeldTotal(rows);

	// The label belongs to the payouts that are actually held, not to the
	// Restaurant's configured currency. They agree today and need not stay so: a
	// restaurant that switches currency would otherwise have its older held
	// payouts silently relabelled into the new one, and the held total is the one
	// number on this page a manager has to be able to trust. With nothing held
	// there is no payout to read it from, so the Restaurant's own currency is the
	// sensible label for a zero.
	const heldCurrency = rows.find((row) =>
		held.unresolvedPayoutIds.includes(row.stripePayoutId)
	)?.currency;

	return { ...held, currency: heldCurrency ?? restaurant.currency };
}

// ============================================================================
// Recording an event
// ============================================================================

/** What `recordPayoutEventInternal` did, so the action can log it meaningfully. */
export type RecordPayoutOutcome = {
	/** `"inserted"`, `"updated"`, `"stale"` (an older event), or `"conflict"`. */
	action: "inserted" | "updated" | "stale" | "conflict";
	/**
	 * True when this event moved the payout into `failed` for the first time —
	 * including a payout that had shown `paid` and was returned by the bank.
	 */
	becameFailed: boolean;
	/** True when that failure was a bank return: the payout had already shown `paid`. */
	returned: boolean;
	/**
	 * True when that failure arrived already superseded by a later payout, so
	 * nobody was told about money that is no longer stuck.
	 */
	supersededOnArrival: boolean;
	/** True when this event cleared the restaurant's last unresolved failure. */
	payoutsResumed: boolean;
	/** Held total after the write, smallest currency unit. */
	heldCents: number;
	/** Managers told (bell rows written). Zero is a real state, not an error. */
	notified: number;
	/** Emails scheduled, one job per recipient. */
	emailsScheduled: number;
};

/**
 * Upsert one payout row and, when the money's story changed, tell the people
 * whose money it is.
 *
 * Called from `stripe.handleConnectedAccountEvent` for every `payout.*` type.
 * Routine payouts — created, in transit, arrived while nothing was stuck —
 * write the row and tell nobody, which is the whole point of `becameFailed` and
 * `payoutsResumed` being computed rather than inferred from the event type: "a
 * payout arrived" is payments-page news, not bell news.
 */
export const recordPayoutEventInternal = internalMutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		stripeAccountId: v.string(),
		stripePayoutId: v.string(),
		amount: v.number(),
		currency: v.string(),
		status: statusValidator,
		/** Stripe's `payout.created`, in ms. */
		createdAt: v.number(),
		arrivalDate: v.optional(v.number()),
		failureCode: v.optional(v.string()),
		/** Raw Stripe sentence, stored for operators and never returned to a manager. */
		failureMessage: v.optional(v.string()),
		failureBalanceTransaction: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<RecordPayoutOutcome> => {
		const heldBefore = computeHeldTotal(await readHeldTotalInputs(ctx, args.restaurantId));

		const existing = await ctx.db
			.query(TABLE.STRIPE_PAYOUTS)
			.withIndex("by_payout_id", (q) => q.eq("stripePayoutId", args.stripePayoutId))
			.first();

		const now = Date.now();
		const fields = {
			restaurantId: args.restaurantId,
			stripeAccountId: args.stripeAccountId,
			stripePayoutId: args.stripePayoutId,
			amount: args.amount,
			currency: args.currency,
			status: args.status,
			arrivalDate: args.arrivalDate,
			failureCode: args.failureCode,
			failureMessage: args.failureMessage,
			failureBalanceTransaction: args.failureBalanceTransaction,
			createdAt: args.createdAt,
			updatedAt: now,
		};

		let action: RecordPayoutOutcome["action"];
		let becameFailed: boolean;
		let returned = false;

		if (!existing) {
			await ctx.db.insert(TABLE.STRIPE_PAYOUTS, fields);
			action = "inserted";
			becameFailed = args.status === STRIPE_PAYOUT_STATUS.FAILED;
		} else {
			const decision = decidePayoutUpdate(
				{ status: existing.status as StripePayoutStatus },
				{ status: args.status }
			);
			if (!decision.apply) {
				if (decision.conflict) {
					console.warn(
						"[payouts.recordPayoutEventInternal] two different terminal statuses for one payout; " +
							"keeping the stored one",
						JSON.stringify({
							stripePayoutId: args.stripePayoutId,
							stored: existing.status,
							incoming: args.status,
						})
					);
				} else {
					console.log(
						"[payouts.recordPayoutEventInternal] ignoring an out-of-order payout event",
						JSON.stringify({
							stripePayoutId: args.stripePayoutId,
							stored: existing.status,
							incoming: args.status,
						})
					);
				}
				return {
					action: decision.conflict ? "conflict" : "stale",
					becameFailed: false,
					returned: false,
					supersededOnArrival: false,
					payoutsResumed: false,
					heldCents: heldBefore.heldCents,
					notified: 0,
					emailsScheduled: 0,
				};
			}

			// A bank return (`paid` → `failed`, Stripe documents it can land days
			// after the payout showed paid). From here on it is an ordinary new
			// failure: `becameFailed` below sends it down the same bell / email /
			// alert path as a first-time `payout.failed`, and the per-payout
			// dedupe keys are fresh because this payout was never failed before.
			// The one difference is WHEN its money came back to the balance —
			// now, not at `createdAt` — which is what stops the routine payouts
			// Stripe made in between from "resolving" it (`computeHeldTotal`).
			// Stamped once: a redelivered `payout.failed` is failed → failed and
			// leaves the original return time alone.
			returned = isPayoutReturn(
				{ status: existing.status as StripePayoutStatus },
				{ status: args.status }
			);
			await ctx.db.patch(existing._id, {
				...fields,
				status: decision.status,
				...(returned && { returnedAt: now }),
			});
			action = "updated";
			becameFailed =
				existing.status !== STRIPE_PAYOUT_STATUS.FAILED &&
				decision.status === STRIPE_PAYOUT_STATUS.FAILED;
		}

		const heldAfter = computeHeldTotal(await readHeldTotalInputs(ctx, args.restaurantId));

		// Payouts resumed: money that was stuck is no longer stuck, and this
		// payout is what proved it. Deliberately not "the capability came back" —
		// see `computeHeldTotal`.
		const payoutsResumed =
			!becameFailed &&
			args.status === STRIPE_PAYOUT_STATUS.PAID &&
			heldBefore.heldCents > 0 &&
			heldAfter.heldCents === 0;

		// A failure can arrive *after* the payout that already resolved it —
		// Stripe's deliveries are not ordered, so Monday's `payout.failed` can
		// land behind Tuesday's `payout.paid`. The row is still written (it
		// really happened, and the payouts page shows it), but there is nothing
		// to tell anyone: the money is not stuck. Announcing it would ring a bell
		// and email a manager about a problem that was over before they heard of
		// it, and raise a severe alert somebody then has to acknowledge.
		const stillHeld = heldAfter.unresolvedPayoutIds.includes(args.stripePayoutId);
		const supersededOnArrival = becameFailed && !stillHeld;
		if (supersededOnArrival) {
			console.log(
				"[payouts.recordPayoutEventInternal] failure arrived already superseded; recording it quietly",
				JSON.stringify({
					stripePayoutId: args.stripePayoutId,
					heldCents: heldAfter.heldCents,
				})
			);
		}

		let notified = 0;
		let emailsScheduled = 0;

		if (becameFailed && stillHeld) {
			const amountFormatted = formatPayoutAmount(args.amount);
			notified = await notifyRestaurantManagers(ctx, {
				restaurantId: args.restaurantId,
				kind: NOTIFICATION_KIND.PAYOUT_FAILED,
				messageKey: PAYOUT_NOTIFICATION_KEY.FAILED,
				messageParams: { amount: amountFormatted, currency: args.currency },
				href: PAYOUTS_PAGE_PATH,
				dedupeKey: `payout_failed:${args.stripePayoutId}`,
			});
			emailsScheduled = await schedulePayoutEmails(ctx, {
				restaurantId: args.restaurantId,
				kind: NOTIFICATION_KIND.PAYOUT_FAILED,
				amountFormatted,
				currency: args.currency,
				failureCode: normalizePayoutFailureCode(args.failureCode),
			});

			// Tavli hears about it too: a bank that refuses a payout is usually
			// something only an operator can help unpick, and the restaurant may
			// have nobody who can read the bell.
			await raiseOperatorAlert(ctx, {
				kind: OPERATOR_ALERT_KIND.PAYOUT_FAILED,
				severity: OPERATOR_ALERT_SEVERITY.SEVERE,
				restaurantId: args.restaurantId,
				stripeObjectId: args.stripePayoutId,
				dedupeKey: `payout_failed:${args.stripePayoutId}`,
			});
		} else if (payoutsResumed) {
			const amountFormatted = formatPayoutAmount(args.amount);
			notified = await notifyRestaurantManagers(ctx, {
				restaurantId: args.restaurantId,
				kind: NOTIFICATION_KIND.PAYOUTS_RESUMED,
				messageKey: PAYOUT_NOTIFICATION_KEY.RESUMED,
				messageParams: { amount: amountFormatted, currency: args.currency },
				href: PAYOUTS_PAGE_PATH,
				dedupeKey: `payouts_resumed:${args.stripePayoutId}`,
			});
			emailsScheduled = await schedulePayoutEmails(ctx, {
				restaurantId: args.restaurantId,
				kind: NOTIFICATION_KIND.PAYOUTS_RESUMED,
				amountFormatted,
				currency: args.currency,
				failureCode: undefined,
			});
		}

		return {
			action,
			becameFailed,
			returned,
			supersededOnArrival,
			payoutsResumed,
			heldCents: heldAfter.heldCents,
			notified,
			emailsScheduled,
		};
	},
});

/**
 * One scheduled email per recipient, to exactly the set that got a bell row.
 *
 * Scheduled rather than sent inline, and one job per address rather than one
 * job for the list, for the same two reasons as the severe-alert email: Resend
 * being down must never fail the transaction that recorded the payout, and one
 * bad address must not silence everybody after it.
 */
async function schedulePayoutEmails(
	ctx: MutationCtx,
	args: {
		restaurantId: Id<"restaurants">;
		kind: typeof NOTIFICATION_KIND.PAYOUT_FAILED | typeof NOTIFICATION_KIND.PAYOUTS_RESUMED;
		amountFormatted: string;
		currency: string;
		failureCode: PayoutFailureCode | undefined;
	}
): Promise<number> {
	const restaurant = await ctx.db.get(args.restaurantId);
	const recipients = await listRestaurantManagerEmails(ctx, args.restaurantId);

	for (const recipient of recipients) {
		await ctx.scheduler.runAfter(0, internal.payoutActions.sendPayoutEmail, {
			email: recipient.email,
			locale: recipient.locale,
			kind: args.kind,
			restaurantName: restaurant?.name ?? null,
			amountFormatted: args.amountFormatted,
			currency: args.currency,
			failureCode: args.failureCode,
		});
	}

	return recipients.length;
}

// ============================================================================
// The payouts page
// ============================================================================

/**
 * One payout as a manager reads it.
 *
 * `failureCode` is the **normalized** code, never Stripe's raw string, and
 * `failureMessage` is absent by construction — it is not in this type, so no
 * future edit can leak it by spreading the document.
 */
export type PayoutListRow = {
	_id: Id<typeof TABLE.STRIPE_PAYOUTS>;
	stripePayoutId: string;
	amount: number;
	currency: string;
	status: StripePayoutStatus;
	/** Stripe's payout date (ms). */
	createdAt: number;
	/** Expected arrival at the bank (ms), when Stripe gave one. */
	arrivalDate: number | undefined;
	/** Set only on a failed payout. */
	failureCode: PayoutFailureCode | undefined;
};

/** Cap on the page's list. A year of daily payouts is ~365 rows. */
export const PAYOUTS_LIST_LIMIT = 200;

export type PayoutsPageData = {
	rows: PayoutListRow[];
	held: RestaurantHeldTotal;
	/** Whether the restaurant has a connected account at all. */
	hasStripeAccount: boolean;
};

function toListRow(doc: PayoutDoc): PayoutListRow {
	return {
		_id: doc._id,
		stripePayoutId: doc.stripePayoutId,
		amount: doc.amount,
		currency: doc.currency,
		status: doc.status as StripePayoutStatus,
		createdAt: doc.createdAt,
		arrivalDate: doc.arrivalDate,
		failureCode:
			doc.status === STRIPE_PAYOUT_STATUS.FAILED
				? normalizePayoutFailureCode(doc.failureCode ?? PAYOUT_FAILURE_CODE.UNKNOWN)
				: undefined,
	};
}

type PayoutsAccessErrors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| NotFoundErrorObject;

/**
 * Every payout of one restaurant, newest first, with the held total alongside.
 *
 * Gated on `requireRestaurantManagerOrAbove`, the same gate as the payments
 * page: a payout is the restaurant's bank account, which an employee has no
 * business reading. One indexed read on `by_restaurant_created`, descending.
 */
export const listByRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async function (ctx, args): AsyncReturn<PayoutsPageData, PayoutsAccessErrors> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];

		const [restaurant, accessError] = await requireRestaurantManagerOrAbove(
			ctx,
			userId,
			args.restaurantId
		);
		if (accessError) return [null, accessError];

		const docs = await ctx.db
			.query(TABLE.STRIPE_PAYOUTS)
			.withIndex("by_restaurant_created", (q) => q.eq("restaurantId", args.restaurantId))
			.order("desc")
			.take(PAYOUTS_LIST_LIMIT);

		return [
			{
				rows: docs.map(toListRow),
				held: await readHeldTotal(ctx, restaurant),
				hasStripeAccount: !!restaurant.stripeAccountId,
			},
			null,
		];
	},
});

/**
 * Just the held total — what the payments-page banner needs.
 *
 * Deliberately separate from `listByRestaurant`: the banner renders on every
 * visit to `/admin/payments`, and it should not pull two hundred payout rows to
 * decide whether to show one line of text.
 */
export const getHeldTotal = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async function (ctx, args): AsyncReturn<RestaurantHeldTotal, PayoutsAccessErrors> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];

		const [restaurant, accessError] = await requireRestaurantManagerOrAbove(
			ctx,
			userId,
			args.restaurantId
		);
		if (accessError) return [null, accessError];

		return [await readHeldTotal(ctx, restaurant), null];
	},
});
