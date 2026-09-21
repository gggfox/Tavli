/**
 * Disputes, the recovery ledger, and telling everybody (TAVLI-102).
 *
 * A chargeback on a Tavli order has always been Tavli's loss, permanently and
 * silently. `createConnectAccount` sets `losses_collector: "application"`, so a
 * lost dispute settles against the PLATFORM balance while the restaurant keeps
 * the transfer it already received, and until this ticket nobody was told — not
 * the restaurant whose order it was, and not Tavli.
 *
 * **The liability model does not change here.** Stripe still takes the money
 * from Tavli. What changes is that the loss is written down (`disputeRecoveries`)
 * and paid back out of the restaurant's *later* order payments, a capped
 * percentage at a time, and that every phase of a dispute now reaches the
 * people it concerns.
 *
 * ## The shape of the money
 *
 * - A lost dispute opens ONE ledger row for the disputed amount. Stripe's
 *   dispute fee is not in it: Tavli absorbs that (it is recorded on the dispute
 *   row and in the per-month fee aggregate instead), because a restaurant
 *   cannot influence it.
 * - Each later ORDER payment — never a tip, never a tab — carries an explicit
 *   `transfer_data.amount` of `restaurantShare − deduction`. The diner's charge
 *   is untouched and the order still reports full revenue; the recovery is its
 *   own line in the payments ledger and the exports.
 * - The ledger is drawn down when that payment **settles**, not when it is
 *   created. A failed or superseded intent moved no money, so the debt stands.
 * - A dispute later won, or whose funds Stripe reinstates, zeroes the row and
 *   returns anything already recovered to the connected account.
 * - After `DISPUTE_RECOVERY_WRITE_OFF_DAYS` an outstanding row is written off
 *   and Tavli keeps the rest of the loss.
 *
 * ## Idempotency
 *
 * Every entry point here is driven by a Stripe webhook, and Stripe redelivers.
 * Three layers stop a duplicate: `stripeWebhookEvents` dedup in
 * `fulfillPayment` catches a replayed *event*; the transition checks below
 * catch a *different* event about a dispute already in that state (a
 * `charge.dispute.updated` that follows a close, say); and the ledger row's own
 * existence is what makes "open a debt" and "return the money" happen once.
 * The bell notifications and the operator alert each carry a `dedupeKey` per
 * dispute on top of that.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import {
	ConflictError,
	fromErrorObject,
	NotFoundError,
	type NotAuthenticatedErrorObject,
	type NotAuthorizedErrorObject,
	type NotFoundErrorObject,
} from "./_shared/errors";
import type { AsyncReturn } from "./_shared/types";
import { appendAuditEvent } from "./_util/audit";
import { getCurrentUserId, requireAdminRole, requireRestaurantManagerOrAbove } from "./_util/auth";
import { listRestaurantManagerEmails, notifyRestaurantManagers } from "./_util/notifications";
import { raiseOperatorAlert } from "./_util/operatorAlerts";
import {
	AUDIT_EVENT,
	AUDIT_SYSTEM_USER_ID,
	DISPUTE_PHASE,
	DISPUTE_PHASES,
	DISPUTE_RECOVERY_DEFAULT_PERCENT,
	DISPUTE_RECOVERY_MAX_PERCENT,
	DISPUTE_RECOVERY_STATUS,
	DISPUTE_RETURN_RESCHEDULE_AFTER_MS,
	NOTIFICATION_KIND,
	OPERATOR_ALERT_KIND,
	OPERATOR_ALERT_SEVERITY,
	PAYMENT_STATUS,
	PAYMENTS_PAGE_PATH,
	STRIPE_ACCOUNT_STATUS,
	TABLE,
	type DisputePhase,
	type DisputeRecoveryStatus,
	type DisputeStatus,
} from "./constants";
import {
	correctDisputeFee,
	DISPUTE_OUTCOME,
	readRestaurantDisputeTotals,
	recordDisputeFee,
	recordDisputeOutcome,
	recordRecoveredTotal,
	readDisputeFeesForMonth,
	type DisputeOutcomeTotals,
} from "./disputeAggregates";
import {
	clampDisputeRecoveryPercent,
	disputeFeeMonthKey,
	isDisputeLost,
	isDisputeWon,
	isValidDisputeRecoveryPercent,
	normalizeDisputeStatus,
	planLedgerDrawDown,
	writeOffCutoff,
} from "./disputeRecoveryHelpers";

type DisputeDoc = Doc<typeof TABLE.STRIPE_DISPUTES>;
type RecoveryDoc = Doc<typeof TABLE.DISPUTE_RECOVERIES>;
type DisputeReadCtx = QueryCtx | MutationCtx;

/**
 * Stable error codes this module returns. The frontend maps them to i18n keys;
 * the backend never emits prose (CLAUDE.md).
 */
export const DISPUTE_ERRORS = {
	RECOVERY_PERCENT_INVALID: "ERROR_DISPUTE_RECOVERY_PERCENT_INVALID",
	/** A refund was attempted on a charge Stripe will not let us refund. */
	PAYMENT_UNDER_DISPUTE: "ERROR_PAYMENT_UNDER_DISPUTE",
} as const;

/** i18n keys for the amount-bearing notification bodies (the defaults take no params). */
export const DISPUTE_NOTIFICATION_KEY = {
	OPENED: "disputes.notification.opened",
	WON: "disputes.notification.won",
	LOST: "disputes.notification.lost",
	LOST_WITH_RECOVERY: "disputes.notification.lostWithRecovery",
} as const;

/** Cap on the disputes list a manager or admin reads in one go. */
export const DISPUTES_LIST_LIMIT = 100;

/**
 * How many ledger rows one payment is priced against.
 *
 * A deduction is drawn oldest-first and is capped at a percentage of one
 * order, so in practice it touches one or two rows. The bound exists so a
 * restaurant with a pathological dispute history cannot turn every checkout
 * into an unbounded read.
 */
const RECOVERY_ROWS_PER_PAYMENT = 20;

/** Validator for the phase enum, so an action cannot invent one. */
const phaseValidator = v.union(...DISPUTE_PHASES.map((phase) => v.literal(phase)));

// ============================================================================
// Reading the ledger
// ============================================================================

/** This restaurant's outstanding ledger rows, oldest loss first. */
async function readOutstandingRecoveries(
	ctx: DisputeReadCtx,
	restaurantId: Id<"restaurants">,
	limit = RECOVERY_ROWS_PER_PAYMENT
): Promise<RecoveryDoc[]> {
	return await ctx.db
		.query(TABLE.DISPUTE_RECOVERIES)
		.withIndex("by_restaurant_status_lost", (q) =>
			q.eq("restaurantId", restaurantId).eq("status", DISPUTE_RECOVERY_STATUS.OUTSTANDING)
		)
		.take(limit);
}

/** The ledger row for one dispute, if a loss ever opened one. */
async function readRecoveryForDispute(
	ctx: DisputeReadCtx,
	stripeDisputeId: string
): Promise<RecoveryDoc | null> {
	return await ctx.db
		.query(TABLE.DISPUTE_RECOVERIES)
		.withIndex("by_dispute_id", (q) => q.eq("stripeDisputeId", stripeDisputeId))
		.first();
}

/** What `createPaymentIntent` needs to price one order's transfer. */
export type RecoveryQuote = {
	/** `restaurants.disputeRecoveryPercent`, clamped to the cap. */
	percent: number;
	/** Σ outstanding over this restaurant's ledger, smallest currency unit. */
	totalOutstanding: number;
	/** The rows behind that total, oldest first — recorded on the payment row. */
	recoveryIds: Id<typeof TABLE.DISPUTE_RECOVERIES>[];
};

/**
 * The recovery position of one restaurant, as the checkout action reads it.
 *
 * Deliberately returns the percentage **and** the total rather than a
 * deduction: the deduction also depends on the order's own money split, which
 * this query has no business knowing, and keeping the arithmetic in
 * `computeDisputeDeduction` keeps it unit-testable without a database.
 */
export const getRecoveryQuoteInternal = internalQuery({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async (ctx, args): Promise<RecoveryQuote> => {
		const restaurant = await ctx.db.get(args.restaurantId);
		const percent = clampDisputeRecoveryPercent(restaurant?.disputeRecoveryPercent);
		// A restaurant with recovery switched off is not even read: the ledger
		// still exists and still reports, but nothing is withheld, so there is
		// nothing to price. This is the common case on every checkout.
		if (percent === 0) return { percent: 0, totalOutstanding: 0, recoveryIds: [] };

		const rows = await readOutstandingRecoveries(ctx, args.restaurantId);
		return {
			percent,
			totalOutstanding: rows.reduce((sum, row) => sum + row.outstanding, 0),
			recoveryIds: rows.map((row) => row._id),
		};
	},
});

/**
 * The open dispute on one payment, if any — the refund guard.
 *
 * "Open" means Stripe has not resolved it: a charge in that state cannot be
 * refunded at all (Stripe answers `charge_disputed`), and a charge we already
 * LOST must not be refunded either — the money went back to the diner through
 * the chargeback, and refunding it again would pay them twice.
 */
export const getBlockingDisputeForPaymentInternal = internalQuery({
	args: { paymentId: v.id(TABLE.PAYMENTS) },
	handler: async (ctx, args): Promise<{ stripeDisputeId: string; status: string } | null> => {
		const disputes = await ctx.db
			.query(TABLE.STRIPE_DISPUTES)
			.withIndex("by_payment", (q) => q.eq("paymentId", args.paymentId))
			.collect();

		for (const dispute of disputes) {
			// A won dispute releases the charge, so a refund is possible again.
			if (isDisputeWon(dispute.status)) continue;
			return { stripeDisputeId: dispute.stripeDisputeId, status: dispute.status };
		}
		return null;
	},
});

// ============================================================================
// Recording a dispute event
// ============================================================================

/** What `recordDisputeEventInternal` did, so the action can log it meaningfully. */
export type RecordDisputeOutcome = {
	disputeId: Id<typeof TABLE.STRIPE_DISPUTES>;
	/** True when this event opened the dispute in our records for the first time. */
	opened: boolean;
	/** True when this event lost the dispute for the first time. */
	lost: boolean;
	/** True when this event won it, or reinstated the funds, for the first time. */
	resolvedInFavour: boolean;
	/** Ledger row opened by a loss, when one was. */
	recoveryId: Id<typeof TABLE.DISPUTE_RECOVERIES> | null;
	/** Money queued for return to the connected account (already recovered). */
	returningCents: number;
	/** Managers told (bell rows written). Zero is a real state, not an error. */
	notified: number;
	/** Emails scheduled, one job per recipient. */
	emailsScheduled: number;
};

/**
 * Upsert one dispute and apply everything its phase implies.
 *
 * Called from `_util/stripe.ts` for all four `charge.dispute.*` types. The
 * phase decides what is *recorded*; the status decides what happens to the
 * *money*, which is why a `charge.dispute.updated` that carries `lost` opens a
 * ledger row exactly like a `closed` would. Stripe's delivery order is not
 * guaranteed and the two event types overlap, so keying the money off the
 * status rather than the event name is what stops a lost dispute from being
 * missed because it arrived under the "wrong" type.
 */
export const recordDisputeEventInternal = internalMutation({
	args: {
		stripeDisputeId: v.string(),
		phase: phaseValidator,
		reason: v.string(),
		/** Stripe's raw status string, stored verbatim for Dashboard comparison. */
		status: v.string(),
		amount: v.number(),
		currency: v.string(),
		eventTimeMs: v.number(),
		restaurantId: v.optional(v.id(TABLE.RESTAURANTS)),
		paymentId: v.optional(v.id(TABLE.PAYMENTS)),
		orderId: v.optional(v.id(TABLE.ORDERS)),
		sessionId: v.optional(v.id(TABLE.SESSIONS)),
		stripeChargeId: v.optional(v.string()),
		stripePaymentIntentId: v.optional(v.string()),
		latestStripeEventId: v.optional(v.string()),
		/** Stripe's dispute fee, when the balance transactions exposed one. */
		feeAmount: v.optional(v.number()),
		feeAtMs: v.optional(v.number()),
	},
	handler: async (ctx, args): Promise<RecordDisputeOutcome> => {
		const now = Date.now();
		const existing = await ctx.db
			.query(TABLE.STRIPE_DISPUTES)
			.withIndex("by_dispute_id", (q) => q.eq("stripeDisputeId", args.stripeDisputeId))
			.first();

		// Transitions are decided from the STORED state, before the patch below
		// overwrites it. A redelivery finds the dispute already in the state the
		// event describes and takes none of the branches.
		const wasOpened = existing?.openedAt !== undefined;
		const wasLost = existing ? isDisputeLost(existing.status) : false;
		const wasResolvedInFavour = existing
			? isDisputeWon(existing.status) || existing.reinstatedAt !== undefined
			: false;

		const nowLost = isDisputeLost(args.status);
		const reinstated = args.phase === DISPUTE_PHASE.FUNDS_REINSTATED;
		// `funds_reinstated` is Stripe telling us the money came back, whatever
		// the status string on the object says. Treated as a win regardless.
		const nowWon = reinstated || isDisputeWon(args.status);

		const disputeId = await upsertDisputeRow(ctx, { args, existing, now, reinstated });
		const dispute = (await ctx.db.get(disputeId)) as DisputeDoc;

		await appendDisputePhaseAudit(ctx, { args, disputeId });
		await recordFeeIfNew(ctx, { dispute, existing, args });

		const outcome: RecordDisputeOutcome = {
			disputeId,
			// The INSERT is the opening, whatever phase carried it. Stripe's
			// delivery order is not guaranteed and a `created` can be dropped
			// outright, so requiring the `created` phase would leave a dispute
			// first seen as `updated` counted as nothing and its managers never
			// told a chargeback existed. `upsertDisputeRow` stamps `openedAt` on
			// any first sighting for exactly the same reason.
			opened: !wasOpened,
			lost: nowLost && !wasLost,
			resolvedInFavour: nowWon && !wasResolvedInFavour,
			recoveryId: null,
			returningCents: 0,
			notified: 0,
			emailsScheduled: 0,
		};

		// Everything below is restaurant-facing or ledger-facing, and both need a
		// restaurant. A dispute on a charge we cannot tie to one of ours (dev and
		// staging share a Stripe test account) is still recorded and still logged;
		// it simply has nobody to tell and no debt to open. The operator alert on
		// a loss is raised either way, below.
		// Counted outside the branch chain below: a dispute first seen as a LOSS
		// was still opened at some point, and "disputes opened" must not depend
		// on which delivery happened to arrive first.
		if (outcome.opened && args.restaurantId) {
			await recordDisputeOutcome(ctx, {
				restaurantId: args.restaurantId,
				stripeDisputeId: args.stripeDisputeId,
				outcome: DISPUTE_OUTCOME.OPENED,
				amount: args.amount,
				whenMs: args.eventTimeMs,
			});
		}

		if (outcome.lost) {
			await applyLoss(ctx, { args, dispute, outcome, now });
		} else if (outcome.resolvedInFavour) {
			await applyWin(ctx, { args, dispute, outcome, now, reinstated });
		} else if (outcome.opened && args.restaurantId) {
			await tellManagers(ctx, {
				restaurantId: args.restaurantId,
				outcome,
				kind: NOTIFICATION_KIND.DISPUTE_OPENED,
				messageKey: DISPUTE_NOTIFICATION_KEY.OPENED,
				dispute,
				recoveryPercent: 0,
			});
		}

		// Outside the transition branches on purpose: a redelivered win is not a
		// transition, and it is exactly when an earlier return transfer is most
		// likely to have died unretried. See `ensureRecoveryReturnScheduled`.
		if (nowWon && args.restaurantId) {
			outcome.returningCents = await ensureRecoveryReturnScheduled(ctx, {
				stripeDisputeId: args.stripeDisputeId,
				restaurantId: args.restaurantId,
			});
		}

		return outcome;
	},
});

/** Insert or patch the `stripeDisputes` row for this delivery. */
async function upsertDisputeRow(
	ctx: MutationCtx,
	input: {
		args: {
			stripeDisputeId: string;
			phase: DisputePhase;
			reason: string;
			status: string;
			amount: number;
			currency: string;
			eventTimeMs: number;
			restaurantId?: Id<"restaurants">;
			paymentId?: Id<"payments">;
			orderId?: Id<"orders">;
			sessionId?: Id<"sessions">;
			stripeChargeId?: string;
			stripePaymentIntentId?: string;
		};
		existing: DisputeDoc | null;
		now: number;
		reinstated: boolean;
	}
): Promise<Id<typeof TABLE.STRIPE_DISPUTES>> {
	const { args, existing, now, reinstated } = input;

	const timestamps = {
		...(args.phase === DISPUTE_PHASE.CREATED && existing?.openedAt === undefined
			? { openedAt: args.eventTimeMs }
			: {}),
		...(args.phase === DISPUTE_PHASE.CLOSED ? { closedAt: args.eventTimeMs } : {}),
		...(reinstated ? { reinstatedAt: args.eventTimeMs } : {}),
	};

	if (existing) {
		await ctx.db.patch(existing._id, {
			reason: args.reason,
			status: args.status,
			amount: args.amount,
			currency: args.currency,
			// Late-resolving links: a `created` that could not find the payment
			// (the row was written moments later) must be able to acquire it on
			// the next delivery, but a known link is never cleared by an event
			// that happens not to carry one.
			...(args.restaurantId && !existing.restaurantId && { restaurantId: args.restaurantId }),
			...(args.paymentId && !existing.paymentId && { paymentId: args.paymentId }),
			...(args.orderId && !existing.orderId && { orderId: args.orderId }),
			...timestamps,
			updatedAt: now,
		});
		return existing._id;
	}

	return await ctx.db.insert(TABLE.STRIPE_DISPUTES, {
		stripeDisputeId: args.stripeDisputeId,
		restaurantId: args.restaurantId,
		paymentId: args.paymentId,
		orderId: args.orderId,
		sessionId: args.sessionId,
		stripeChargeId: args.stripeChargeId,
		stripePaymentIntentId: args.stripePaymentIntentId,
		reason: args.reason,
		status: args.status,
		amount: args.amount,
		currency: args.currency,
		// A dispute first seen on a non-`created` delivery still gets an
		// `openedAt`: it was open before we heard about it, and a blank opening
		// date on the manager's screen is worse than the event's own timestamp.
		openedAt: args.eventTimeMs,
		...(args.phase === DISPUTE_PHASE.CLOSED ? { closedAt: args.eventTimeMs } : {}),
		...(input.reinstated ? { reinstatedAt: args.eventTimeMs } : {}),
		createdAt: input.now,
		updatedAt: input.now,
	});
}

/** The per-phase audit event. Idempotent on the Stripe event id. */
async function appendDisputePhaseAudit(
	ctx: MutationCtx,
	input: {
		args: {
			stripeDisputeId: string;
			phase: DisputePhase;
			reason: string;
			status: string;
			amount: number;
			currency: string;
			restaurantId?: Id<"restaurants">;
			paymentId?: Id<"payments">;
			latestStripeEventId?: string;
		};
		disputeId: Id<typeof TABLE.STRIPE_DISPUTES>;
	}
): Promise<void> {
	const { args, disputeId } = input;
	const eventType: Record<DisputePhase, string> = {
		[DISPUTE_PHASE.CREATED]: AUDIT_EVENT.DISPUTE_OPENED,
		[DISPUTE_PHASE.UPDATED]: AUDIT_EVENT.DISPUTE_UPDATED,
		[DISPUTE_PHASE.CLOSED]: AUDIT_EVENT.DISPUTE_CLOSED,
		[DISPUTE_PHASE.FUNDS_REINSTATED]: AUDIT_EVENT.DISPUTE_FUNDS_REINSTATED,
	};

	await appendAuditEvent(ctx, {
		aggregateType: args.paymentId ? TABLE.PAYMENTS : TABLE.STRIPE_DISPUTES,
		aggregateId: args.paymentId ?? disputeId,
		eventType: eventType[args.phase],
		// Best-effort like the dispute row itself: absent when the charge could
		// not be linked back to one of our restaurants.
		restaurantId: args.restaurantId ?? null,
		payload: {
			stripeDisputeId: args.stripeDisputeId,
			reason: args.reason,
			status: args.status,
			amount: args.amount,
			currency: args.currency,
		},
		userId: AUDIT_SYSTEM_USER_ID,
		idempotencyKey: args.latestStripeEventId
			? `charge.dispute.${args.phase}:${args.latestStripeEventId}`
			: undefined,
	});
}

/**
 * Record Stripe's dispute fee the first time we learn it.
 *
 * Guarded on the stored field being absent rather than on the event type: the
 * fee can arrive on any delivery (a warning-stage dispute has none, a lost one
 * does), and whichever delivery carries it first is the one that writes it.
 * The aggregate write is in the same transaction, so the per-month total can
 * never disagree with the rows behind it.
 */
async function recordFeeIfNew(
	ctx: MutationCtx,
	input: {
		dispute: DisputeDoc;
		existing: DisputeDoc | null;
		args: {
			stripeDisputeId: string;
			phase: DisputePhase;
			currency: string;
			restaurantId?: Id<"restaurants">;
			feeAmount?: number;
			feeAtMs?: number;
		};
	}
): Promise<void> {
	const { dispute, existing, args } = input;
	if (args.feeAmount === undefined) return;

	// A dispute whose funds are reinstated usually has its fee refunded too,
	// which Stripe posts as a NEGATIVE balance transaction — so the summed fee
	// can fall, to zero or below. That is a correction of a number already in
	// the month's total, not a new fee, so it is the one case that may overwrite
	// a fee we have already recorded. Everything else keeps the
	// first-delivery-wins rule: the fee arrives on whichever delivery has it.
	const isCorrection = args.phase === DISPUTE_PHASE.FUNDS_REINSTATED;
	if (existing?.disputeFeeAmount !== undefined && !isCorrection) return;
	if (existing?.disputeFeeAmount === undefined && args.feeAmount <= 0) return;

	if (isCorrection && existing?.disputeFeeAmount !== undefined) {
		const priorMonth = existing.disputeFeeMonth ?? disputeFeeMonthKey(dispute.createdAt);
		const net = args.feeAmount;
		await ctx.db.patch(dispute._id, {
			disputeFeeAmount: net > 0 ? net : undefined,
			disputeFeeMonth: net > 0 ? priorMonth : undefined,
			updatedAt: Date.now(),
		});
		await correctDisputeFee(ctx, {
			stripeDisputeId: args.stripeDisputeId,
			month: priorMonth,
			feeAmount: net,
		});
		await appendAuditEvent(ctx, {
			aggregateType: TABLE.STRIPE_DISPUTES,
			aggregateId: dispute._id,
			eventType: AUDIT_EVENT.DISPUTE_FEE_ABSORBED,
			restaurantId: args.restaurantId ?? null,
			payload: {
				stripeDisputeId: args.stripeDisputeId,
				feeAmount: net,
				previousFeeAmount: existing.disputeFeeAmount,
				currency: args.currency,
				month: priorMonth,
				correction: "funds_reinstated",
				absorbedBy: "platform",
			},
			userId: AUDIT_SYSTEM_USER_ID,
			idempotencyKey: `dispute_fee_corrected:${args.stripeDisputeId}:${net}`,
		});
		return;
	}

	const month = disputeFeeMonthKey(args.feeAtMs ?? dispute.createdAt);
	await ctx.db.patch(dispute._id, {
		disputeFeeAmount: args.feeAmount,
		disputeFeeMonth: month,
		updatedAt: Date.now(),
	});
	await recordDisputeFee(ctx, {
		stripeDisputeId: args.stripeDisputeId,
		feeAmount: args.feeAmount,
		month,
	});
	await appendAuditEvent(ctx, {
		aggregateType: TABLE.STRIPE_DISPUTES,
		aggregateId: dispute._id,
		eventType: AUDIT_EVENT.DISPUTE_FEE_ABSORBED,
		restaurantId: args.restaurantId ?? null,
		payload: {
			stripeDisputeId: args.stripeDisputeId,
			feeAmount: args.feeAmount,
			currency: args.currency,
			month,
			// Said out loud in the audit trail, because this is the one number in
			// the dispute flow that is deliberately NOT charged onward.
			absorbedBy: "platform",
		},
		userId: AUDIT_SYSTEM_USER_ID,
		idempotencyKey: `dispute_fee:${args.stripeDisputeId}`,
	});
}

/**
 * The dispute closed against us: open the ledger row, tell everybody.
 *
 * The operator alert is raised even when no restaurant claims the charge —
 * that is precisely the case nobody would otherwise ever see — while the ledger
 * row and the manager notifications need a restaurant to belong to.
 */
async function applyLoss(
	ctx: MutationCtx,
	input: {
		args: {
			stripeDisputeId: string;
			amount: number;
			currency: string;
			eventTimeMs: number;
			restaurantId?: Id<"restaurants">;
			paymentId?: Id<"payments">;
			orderId?: Id<"orders">;
		};
		dispute: DisputeDoc;
		outcome: RecordDisputeOutcome;
		now: number;
	}
): Promise<void> {
	const { args, dispute, outcome, now } = input;

	await raiseOperatorAlert(ctx, {
		kind: OPERATOR_ALERT_KIND.DISPUTE_LOST,
		severity: OPERATOR_ALERT_SEVERITY.SEVERE,
		...(args.restaurantId && { restaurantId: args.restaurantId }),
		...(args.paymentId && { paymentId: args.paymentId }),
		stripeObjectId: args.stripeDisputeId,
		dedupeKey: `dispute_lost:${args.stripeDisputeId}`,
	});

	if (!args.restaurantId) return;

	const existingRecovery = await readRecoveryForDispute(ctx, args.stripeDisputeId);
	if (!existingRecovery) {
		const recoveryId = await ctx.db.insert(TABLE.DISPUTE_RECOVERIES, {
			restaurantId: args.restaurantId,
			stripeDisputeId: args.stripeDisputeId,
			paymentId: args.paymentId,
			orderId: args.orderId,
			amount: args.amount,
			outstanding: args.amount,
			recovered: 0,
			currency: args.currency,
			status: DISPUTE_RECOVERY_STATUS.OUTSTANDING,
			lostAt: args.eventTimeMs,
			createdAt: now,
			updatedAt: now,
		});
		outcome.recoveryId = recoveryId;

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.DISPUTE_RECOVERIES,
			aggregateId: recoveryId,
			eventType: AUDIT_EVENT.DISPUTE_RECOVERY_OPENED,
			restaurantId: args.restaurantId,
			payload: {
				stripeDisputeId: args.stripeDisputeId,
				amount: args.amount,
				currency: args.currency,
				// The fee is on the dispute row, not in this number.
				excludesDisputeFee: true,
			},
			userId: AUDIT_SYSTEM_USER_ID,
			idempotencyKey: `dispute_recovery_opened:${args.stripeDisputeId}`,
		});
	} else {
		outcome.recoveryId = existingRecovery._id;
	}

	await recordDisputeOutcome(ctx, {
		restaurantId: args.restaurantId,
		stripeDisputeId: args.stripeDisputeId,
		outcome: DISPUTE_OUTCOME.LOST,
		amount: args.amount,
		whenMs: args.eventTimeMs,
	});

	const restaurant = await ctx.db.get(args.restaurantId);
	const percent = clampDisputeRecoveryPercent(restaurant?.disputeRecoveryPercent);
	await tellManagers(ctx, {
		restaurantId: args.restaurantId,
		outcome,
		kind: NOTIFICATION_KIND.DISPUTE_LOST,
		// The copy differs by whether recovery applies at all: telling a
		// restaurant with `percent: 0` that we will withhold from future orders
		// would be false, and telling one with `percent: 25` nothing would be a
		// surprise the first time an order pays out short.
		messageKey:
			percent > 0 ? DISPUTE_NOTIFICATION_KEY.LOST_WITH_RECOVERY : DISPUTE_NOTIFICATION_KEY.LOST,
		dispute,
		recoveryPercent: percent,
	});
}

/**
 * The dispute resolved in the restaurant's favour: cancel the debt, and give
 * back anything already taken.
 *
 * The return is a scheduled action rather than an inline transfer for the same
 * reason the emails are: Stripe being slow or down must not fail the
 * transaction that recorded the win. The ledger row is what remembers the
 * money is owed, so a failed action leaves a recoverable state rather than a
 * silent loss.
 */
async function applyWin(
	ctx: MutationCtx,
	input: {
		args: {
			stripeDisputeId: string;
			amount: number;
			currency: string;
			eventTimeMs: number;
			restaurantId?: Id<"restaurants">;
		};
		dispute: DisputeDoc;
		outcome: RecordDisputeOutcome;
		now: number;
		reinstated: boolean;
	}
): Promise<void> {
	const { args, dispute, outcome, now } = input;
	if (!args.restaurantId) return;

	await recordDisputeOutcome(ctx, {
		restaurantId: args.restaurantId,
		stripeDisputeId: args.stripeDisputeId,
		outcome: DISPUTE_OUTCOME.WON,
		amount: args.amount,
		whenMs: args.eventTimeMs,
	});

	const recovery = await readRecoveryForDispute(ctx, args.stripeDisputeId);
	if (recovery && recovery.status !== DISPUTE_RECOVERY_STATUS.REINSTATED) {
		await ctx.db.patch(recovery._id, {
			outstanding: 0,
			status: DISPUTE_RECOVERY_STATUS.REINSTATED,
			reinstatedAt: args.eventTimeMs,
			updatedAt: now,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.DISPUTE_RECOVERIES,
			aggregateId: recovery._id,
			eventType: AUDIT_EVENT.DISPUTE_RECOVERY_REVERSED,
			restaurantId: args.restaurantId,
			payload: {
				stripeDisputeId: args.stripeDisputeId,
				cancelledOutstanding: recovery.outstanding,
				returning: recovery.recovered,
				currency: recovery.currency,
			},
			userId: AUDIT_SYSTEM_USER_ID,
			idempotencyKey: `dispute_recovery_reversed:${args.stripeDisputeId}`,
		});
	}

	await tellManagers(ctx, {
		restaurantId: args.restaurantId,
		outcome,
		kind: NOTIFICATION_KIND.DISPUTE_WON,
		messageKey: DISPUTE_NOTIFICATION_KEY.WON,
		dispute,
		recoveryPercent: 0,
	});
}

/**
 * Make sure a reinstated dispute's recovered money is on its way back.
 *
 * Called for **every** delivery that says the dispute went our way, not only
 * the one that first said so. Convex does not retry a scheduled function that
 * throws, so a return whose `transfers.create` failed leaves a row that is
 * reinstated, still owes the restaurant money, and whose managers have already
 * been told the money is coming back. A redelivered win is the event most
 * likely to arrive after exactly that failure — and gating on the *transition*
 * (`resolvedInFavour`) or on the row's *status* would make it the one event
 * guaranteed to skip the retry.
 *
 * `returnedAt` is therefore the only gate, and Stripe's idempotency key
 * (`dispute-recovery-return:<disputeId>`) is what makes re-scheduling safe: a
 * second call returns Stripe's record of the first transfer rather than making
 * a second one. The daily sweep is the third line of defence.
 *
 * Only money we actually took comes back: a dispute lost and won again before
 * any order paid it down owes the restaurant nothing.
 */
async function ensureRecoveryReturnScheduled(
	ctx: MutationCtx,
	args: { stripeDisputeId: string; restaurantId: Id<"restaurants"> }
): Promise<number> {
	const recovery = await readRecoveryForDispute(ctx, args.stripeDisputeId);
	if (!recovery || recovery.recovered <= 0 || recovery.returnedAt !== undefined) return 0;

	const restaurant = await ctx.db.get(args.restaurantId);
	// A CLOSED connected account cannot receive a transfer, so scheduling one is
	// a guaranteed dead action plus a second severe alert saying nothing the
	// first did not. One alert, naming what is stuck, and no doomed job.
	if (!isPayableConnectedAccount(restaurant)) {
		// Nowhere to send it. The row keeps `recovered` so the debt is visible
		// and an operator can settle it by hand.
		await raiseOperatorAlert(ctx, {
			kind: OPERATOR_ALERT_KIND.DISPUTE_LOST,
			severity: OPERATOR_ALERT_SEVERITY.SEVERE,
			restaurantId: args.restaurantId,
			stripeObjectId: args.stripeDisputeId,
			dedupeKey: `dispute_recovery_return_blocked:${args.stripeDisputeId}`,
		});
		return 0;
	}

	await ctx.db.patch(recovery._id, { returnScheduledAt: Date.now(), updatedAt: Date.now() });
	await ctx.scheduler.runAfter(0, internal.disputeActions.returnRecoveredFunds, {
		recoveryId: recovery._id,
		stripeAccountId: restaurant.stripeAccountId,
		stripeDisputeId: args.stripeDisputeId,
		amount: recovery.recovered,
		currency: recovery.currency,
	});
	return recovery.recovered;
}

// ============================================================================
// Telling the restaurant
// ============================================================================

/**
 * One bell row and one email per manager, to exactly the same set.
 *
 * Both carry a `dedupeKey` naming the dispute and the phase, so Stripe's
 * redeliveries and our own retries cannot ring the same bell twice. The email
 * is scheduled per recipient, like the payout email: Resend being down must
 * not fail the transaction that recorded the dispute, and one bad address must
 * not silence everybody after it.
 */
async function tellManagers(
	ctx: MutationCtx,
	input: {
		restaurantId: Id<"restaurants">;
		outcome: RecordDisputeOutcome;
		kind:
			| typeof NOTIFICATION_KIND.DISPUTE_OPENED
			| typeof NOTIFICATION_KIND.DISPUTE_WON
			| typeof NOTIFICATION_KIND.DISPUTE_LOST;
		messageKey: string;
		dispute: DisputeDoc;
		recoveryPercent: number;
	}
): Promise<void> {
	const { dispute } = input;
	const amountFormatted = formatDisputeAmount(dispute.amount);

	input.outcome.notified = await notifyRestaurantManagers(ctx, {
		restaurantId: input.restaurantId,
		kind: input.kind,
		messageKey: input.messageKey,
		messageParams: {
			amount: amountFormatted,
			currency: dispute.currency.toUpperCase(),
			percent: input.recoveryPercent,
		},
		href: PAYMENTS_PAGE_PATH,
		dedupeKey: `${input.kind}:${dispute.stripeDisputeId}`,
	});

	const restaurant = await ctx.db.get(input.restaurantId);
	const order = dispute.orderId ? await ctx.db.get(dispute.orderId) : null;
	const recipients = await listRestaurantManagerEmails(ctx, input.restaurantId);
	for (const recipient of recipients) {
		await ctx.scheduler.runAfter(0, internal.disputeActions.sendDisputeEmail, {
			email: recipient.email,
			locale: recipient.locale,
			kind: input.kind,
			restaurantName: restaurant?.name ?? null,
			amountFormatted,
			currency: dispute.currency.toUpperCase(),
			orderNumber: order?.dailyOrderNumber ?? null,
			recoveryPercent: input.recoveryPercent,
		});
	}
	input.outcome.emailsScheduled = recipients.length;
}

/**
 * Money as the notification and the email render it: grouped, two decimals,
 * no symbol (the copy supplies the currency code).
 *
 * The same shape as `formatPayoutAmount`, and for the same reason — the bell
 * row stores a string param, so the formatting has to happen where the number
 * is, not in a translation.
 */
export function formatDisputeAmount(cents: number): string {
	return (cents / 100).toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
}

// ============================================================================
// Drawing the ledger down
// ============================================================================

/**
 * Apply one settled payment's deduction to the ledger.
 *
 * Called from `handlePaymentIntentSuccess` after the payment has been
 * confirmed, and **only** then: the deduction was priced when the intent was
 * created, but an intent that fails or is superseded moves no money, so the
 * debt has to stand. That is the whole reason this is a separate step rather
 * than part of pricing.
 *
 * Idempotent three ways: `disputeRecoveryAppliedAt` is the marker, the payment
 * must be `succeeded`, and the draw-down is re-planned from the rows' *current*
 * `outstanding` rather than from the plan recorded at pricing time — so a
 * ledger that moved in between (another order settled first, or the dispute was
 * won) is honoured instead of over-drawn.
 *
 * **Whatever cannot be applied is transferred back.** Re-planning is the right
 * behaviour for the ledger and the wrong one for the money: Stripe has already
 * withheld `disputeRecoveryAmount` from this transfer, so if the dispute was
 * reinstated between pricing and settlement — or two intents were priced
 * against the same last 500 and both settled — the difference is sitting on the
 * PLATFORM balance and belongs to the restaurant. It is returned with
 * `dispute-recovery-shortfall:<paymentId>` as the idempotency key, and
 * `disputeRecoveryAmount` is corrected to what was actually applied so the
 * exports report what Tavli kept rather than what it briefly held.
 */
export const applyDisputeRecoveryOnSettleInternal = internalMutation({
	args: { paymentId: v.id(TABLE.PAYMENTS) },
	handler: async (ctx, args): Promise<{ applied: number; shortfall: number; legs: number }> => {
		const payment = await ctx.db.get(args.paymentId);
		const nothing = { applied: 0, shortfall: 0, legs: 0 };
		if (!payment) return nothing;
		if (payment.status !== PAYMENT_STATUS.SUCCEEDED) return nothing;
		if (payment.disputeRecoveryAppliedAt !== undefined) return nothing;

		const intended = payment.disputeRecoveryAmount ?? 0;
		if (intended <= 0) return nothing;

		const now = Date.now();
		const rows = await readOutstandingRecoveries(ctx, payment.restaurantId);
		const legs = planLedgerDrawDown(
			rows.map((row) => ({ id: row._id, outstanding: row.outstanding, lostAt: row.lostAt })),
			intended
		);

		let applied = 0;
		const appliedLegs: { recoveryId: Id<typeof TABLE.DISPUTE_RECOVERIES>; amount: number }[] = [];
		for (const leg of legs) {
			const row = rows.find((candidate) => candidate._id === leg.id);
			if (!row) continue;
			const outstanding = row.outstanding - leg.amount;
			const recovered = row.recovered + leg.amount;
			await ctx.db.patch(row._id, {
				outstanding,
				recovered,
				status:
					outstanding === 0
						? DISPUTE_RECOVERY_STATUS.RECOVERED
						: DISPUTE_RECOVERY_STATUS.OUTSTANDING,
				updatedAt: now,
			});
			await recordRecoveredTotal(ctx, {
				restaurantId: row.restaurantId,
				stripeDisputeId: row.stripeDisputeId,
				recovered,
				lostAt: row.lostAt,
			});
			applied += leg.amount;
			appliedLegs.push({ recoveryId: row._id, amount: leg.amount });
		}

		const shortfall = intended - applied;

		// `disputeRecoveryAmount` is corrected to what was actually applied. It
		// started life as an intention (what the intent asked Stripe to withhold)
		// and from here it has to be a fact, because the exports read it as one.
		await ctx.db.patch(payment._id, {
			disputeRecoveryAppliedAt: now,
			disputeRecoveryAmount: applied,
			disputeRecoveryLegs: appliedLegs,
			...(shortfall > 0 && { disputeRecoveryShortfall: shortfall }),
			updatedAt: now,
			updatedBy: AUDIT_SYSTEM_USER_ID,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.PAYMENTS,
			aggregateId: payment._id,
			eventType: AUDIT_EVENT.DISPUTE_RECOVERY_APPLIED,
			restaurantId: payment.restaurantId,
			payload: {
				withheldAtStripe: intended,
				appliedToLedger: applied,
				returnedToRestaurant: shortfall,
				legs: legs.length,
				currency: payment.currency,
			},
			userId: AUDIT_SYSTEM_USER_ID,
			idempotencyKey: `dispute_recovery_applied:${payment._id}`,
		});

		if (shortfall > 0) {
			const restaurant = await ctx.db.get(payment.restaurantId);
			if (isPayableConnectedAccount(restaurant)) {
				// Flagged BEFORE scheduling, so an action that dies leaves the
				// daily sweep something to find. Cleared when the transfer settles.
				await ctx.db.patch(payment._id, { disputeRecoveryShortfallPending: true });
				await ctx.scheduler.runAfter(0, internal.disputeActions.returnRecoveryShortfall, {
					paymentId: payment._id,
					stripeAccountId: restaurant.stripeAccountId,
					amount: shortfall,
					currency: payment.currency,
				});
			} else {
				// Nowhere to send it. The field on the payment keeps the amount
				// visible so an operator can settle it by hand.
				await raiseOperatorAlert(ctx, {
					kind: OPERATOR_ALERT_KIND.DISPUTE_LOST,
					severity: OPERATOR_ALERT_SEVERITY.SEVERE,
					restaurantId: payment.restaurantId,
					paymentId: payment._id,
					dedupeKey: `dispute_recovery_shortfall_blocked:${payment._id}`,
				});
			}
		}

		return { applied, shortfall, legs: legs.length };
	},
});

/**
 * Mark a payment's shortfall transfer as settled.
 *
 * The Stripe transfer carries `dispute-recovery-shortfall:${paymentId}`, so
 * Stripe itself refuses a second one; this is the in-app half, so the payment
 * row agrees and an operator can find the transfer beside the payment.
 */
export const markRecoveryShortfallReturnedInternal = internalMutation({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		stripeTransferId: v.string(),
		amount: v.number(),
	},
	handler: async (ctx, args): Promise<void> => {
		const payment = await ctx.db.get(args.paymentId);
		if (!payment || payment.disputeRecoveryShortfallReturnedAt !== undefined) return;

		const now = Date.now();
		await ctx.db.patch(payment._id, {
			disputeRecoveryShortfallReturnedAt: now,
			disputeRecoveryShortfallTransferId: args.stripeTransferId,
			disputeRecoveryShortfallPending: undefined,
			updatedAt: now,
			updatedBy: AUDIT_SYSTEM_USER_ID,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.PAYMENTS,
			aggregateId: payment._id,
			eventType: AUDIT_EVENT.DISPUTE_RECOVERY_SHORTFALL_RETURNED,
			restaurantId: payment.restaurantId,
			payload: {
				stripeTransferId: args.stripeTransferId,
				amount: args.amount,
				currency: payment.currency,
			},
			userId: AUDIT_SYSTEM_USER_ID,
			idempotencyKey: `dispute_recovery_shortfall_returned:${payment._id}`,
		});
	},
});

/**
 * Give the ledger back what a refund undid (TAVLI-102, review round 1).
 *
 * A refund on a payment that drew the ledger down is a double loss if nothing
 * is done. Stripe returns the **whole** amount the diner paid out of the
 * PLATFORM balance, and reverses only the transfer that actually went out —
 * which was already short by the recovery. So Tavli pays the diner in full,
 * claws back a reduced transfer, and the ledger still says the debt was repaid.
 * It was not: nobody's money moved in Tavli's favour.
 *
 * The restored amount is proportional to how much of the charge was refunded,
 * so a single line removed from an order gives back its share and a full
 * refund gives back all of it. It is allocated over `disputeRecoveryLegs` in
 * the order the draw-down took them, and the allocation is recomputed from the
 * cumulative total each time rather than from a delta — which is what makes a
 * partial refund followed by a full one, or a redelivered `charge.refunded`,
 * land on the same numbers instead of compounding.
 *
 * Rows that have since been **reinstated** or **written off** are skipped, and
 * deliberately: a reinstated row's `recovered` has already been transferred
 * back to the restaurant, and a written-off row is closed. Resurrecting either
 * would invent a debt. The audit event records the gap.
 *
 * Called from `stripeHelpers.recordChargeRefund`, in the same transaction that
 * records the refund, so the two can never disagree.
 */
export async function restoreLedgerForRefund(
	ctx: MutationCtx,
	args: { paymentId: Id<"payments">; amountRefunded: number }
): Promise<{ restored: number; skipped: number; clawedBack: number }> {
	const payment = await ctx.db.get(args.paymentId);
	const nothing = { restored: 0, skipped: 0, clawedBack: 0 };
	if (!payment) return nothing;
	if (payment.disputeRecoveryAppliedAt === undefined) return nothing;

	const now = Date.now();
	let clawedBack = 0;

	// The shortfall went out on a transfer of its own, and a refund reverses the
	// CHARGE's transfer and nothing else. Handled FIRST and unconditionally,
	// because it has nothing to do with the ledger: a payment whose whole
	// deduction became shortfall has `applied: 0` and no legs at all, and every
	// ledger-shaped early return below would otherwise skip straight past it —
	// leaving the restaurant holding the shortfall on a sale refunded in full.
	if (payment.disputeRecoveryShortfallTransferId && payment.disputeRecoveryShortfall) {
		const shortfallTarget = Math.min(
			payment.disputeRecoveryShortfall,
			Math.floor(
				(payment.disputeRecoveryShortfall * Math.max(0, args.amountRefunded)) /
					Math.max(1, payment.amount)
			)
		);
		clawedBack += await scheduleReturnReversal(ctx, {
			payment,
			stripeTransferId: payment.disputeRecoveryShortfallTransferId,
			targetReversal: shortfallTarget,
			label: "recovery shortfall",
		});
	}

	const applied = payment.disputeRecoveryAmount ?? 0;
	const legs = payment.disputeRecoveryLegs ?? [];
	if (applied <= 0 || legs.length === 0) return { ...nothing, clawedBack };

	const alreadyRestored = payment.disputeRecoveryRestored ?? 0;
	const target = Math.min(
		applied,
		Math.floor((applied * Math.max(0, args.amountRefunded)) / Math.max(1, payment.amount))
	);
	if (target <= alreadyRestored) return { ...nothing, clawedBack };

	// Greedy over the legs in draw-down order. A pure function of the total, so
	// the difference between two totals is the work still to do.
	const allocate = (total: number): number[] => {
		let remaining = total;
		return legs.map((leg) => {
			const take = Math.min(leg.amount, Math.max(0, remaining));
			remaining -= take;
			return take;
		});
	};
	const previous = allocate(alreadyRestored);
	const next = allocate(target);

	let restored = 0;
	let skipped = 0;
	let pendingReturnsTrimmed = 0;
	// Copied so the per-leg `trimmed` tallies can be written back in one patch.
	const legsOut = legs.map((leg) => ({ ...leg }));

	for (const [index, leg] of legs.entries()) {
		const delta = next[index] - previous[index];
		if (delta <= 0) continue;

		const row = await ctx.db.get(leg.recoveryId);
		if (!row || row.status === DISPUTE_RECOVERY_STATUS.WRITTEN_OFF) {
			// A written-off row's money was never paid to anyone: Tavli kept it
			// and then absorbed the rest. There is nothing to put back and
			// nothing to claw back.
			skipped += delta;
			continue;
		}

		if (row.status === DISPUTE_RECOVERY_STATUS.REINSTATED) {
			// The debt is cancelled, so the ledger cannot take the money back.
			// What matters is where the money physically went.
			if (row.stripeTransferId && row.returnedAt !== undefined) {
				// Out to the restaurant, on a transfer of its own — and a refund
				// reverses only the CHARGE's transfer, so that one is untouched.
				// Left alone, the restaurant keeps it on a sale that was refunded
				// in full from Tavli's balance. Reverse this payment's share.
				//
				// MINUS whatever an earlier refund already trimmed off the pending
				// return before it left: that share never travelled, so asking
				// Stripe to reverse it would exceed what the transfer carried and
				// be rejected — an alert about money that was never misplaced.
				const alreadyTrimmed = legsOut[index].trimmed ?? 0;
				clawedBack += await scheduleReturnReversal(ctx, {
					payment,
					stripeTransferId: row.stripeTransferId,
					targetReversal: Math.max(0, next[index] - alreadyTrimmed),
					label: `dispute ${row.stripeDisputeId}`,
				});
			} else {
				// Reinstated but not yet paid out: trim the pending return instead,
				// which is cheaper and exact — the transfer has not happened, so
				// there is nothing to reverse. Tallied per leg so a later
				// claw-back knows this share never left.
				await ctx.db.patch(row._id, {
					recovered: Math.max(0, row.recovered - delta),
					updatedAt: now,
				});
				legsOut[index].trimmed = (legsOut[index].trimmed ?? 0) + delta;
				pendingReturnsTrimmed += delta;
			}
			skipped += delta;
			continue;
		}

		const outstanding = row.outstanding + delta;
		const recovered = Math.max(0, row.recovered - delta);
		await ctx.db.patch(row._id, {
			outstanding,
			recovered,
			status: DISPUTE_RECOVERY_STATUS.OUTSTANDING,
			updatedAt: now,
		});
		await recordRecoveredTotal(ctx, {
			restaurantId: row.restaurantId,
			stripeDisputeId: row.stripeDisputeId,
			recovered,
			lostAt: row.lostAt,
		});
		restored += delta;
	}

	// The cumulative total counts the skipped rows too: they were allocated and
	// must not be re-attempted on the next delivery, and the audit event below
	// is where an operator sees what could not be put back.
	await ctx.db.patch(payment._id, {
		disputeRecoveryRestored: target,
		...(pendingReturnsTrimmed > 0 && { disputeRecoveryLegs: legsOut }),
		updatedAt: now,
		updatedBy: AUDIT_SYSTEM_USER_ID,
	});

	await appendAuditEvent(ctx, {
		aggregateType: TABLE.PAYMENTS,
		aggregateId: payment._id,
		eventType: AUDIT_EVENT.DISPUTE_RECOVERY_RESTORED,
		restaurantId: payment.restaurantId,
		payload: {
			amountRefunded: args.amountRefunded,
			chargeAmount: payment.amount,
			appliedToLedger: applied,
			restoredNow: restored,
			restoredTotal: target,
			skippedClosedRows: skipped,
			clawedBackFromTransfers: clawedBack,
			pendingReturnsTrimmed,
			currency: payment.currency,
		},
		userId: AUDIT_SYSTEM_USER_ID,
		idempotencyKey: `dispute_recovery_restored:${payment._id}:${target}`,
	});

	return { restored, skipped, clawedBack };
}

/**
 * Take back part of a transfer Tavli made outside the charge.
 *
 * Two of this ticket's paths pay the restaurant with a **standalone**
 * `transfers.create`: the return of a reinstated dispute's recovery, and the
 * shortfall a settled payment withheld but could not apply. Refunding the
 * charge reverses the charge's own transfer and **nothing else** — Stripe has
 * no idea those two are related to it — so without this the restaurant keeps
 * money paid against a sale that has since been refunded in full out of the
 * platform balance. Silent, and in Tavli's disfavour every time.
 *
 * `targetReversal` is **cumulative**: the total that should have come off this
 * transfer given everything refunded so far. Only the difference from what has
 * already been reversed is sent, so a partial refund followed by the rest
 * reverses the remainder rather than the whole amount twice, and a redelivered
 * `charge.refunded` sends nothing at all.
 *
 * The Stripe idempotency key therefore carries the cumulative target as well as
 * the payment and transfer: a fixed key would make the second, legitimate
 * reversal return Stripe's record of the first instead of reversing anything.
 */
async function scheduleReturnReversal(
	ctx: MutationCtx,
	input: {
		payment: Doc<"payments">;
		stripeTransferId: string;
		/** Cumulative amount that should be reversed out of this transfer. */
		targetReversal: number;
		/** For the log line: what this transfer was for. */
		label: string;
	}
): Promise<number> {
	const { payment, stripeTransferId, targetReversal } = input;

	// `disputeReturnReversals` only moves when Stripe confirms, so a second,
	// larger refund arriving before the first reversal settles would read
	// "nothing reversed yet" and re-send the whole new target — reversing the
	// first slice twice, or colliding with it, depending on what Stripe sees
	// second. The pending list is what makes each step send only its own delta.
	const confirmed =
		payment.disputeReturnReversals?.find((r) => r.stripeTransferId === stripeTransferId)?.amount ??
		0;
	const pending =
		payment.disputeReturnReversalsPending?.find((r) => r.stripeTransferId === stripeTransferId)
			?.amount ?? 0;
	const already = Math.max(confirmed, pending);
	const delta = targetReversal - already;
	if (delta <= 0) return 0;

	const pendingList = [...(payment.disputeReturnReversalsPending ?? [])];
	const index = pendingList.findIndex((r) => r.stripeTransferId === stripeTransferId);
	if (index >= 0) pendingList[index] = { stripeTransferId, amount: targetReversal };
	else pendingList.push({ stripeTransferId, amount: targetReversal });
	await ctx.db.patch(payment._id, { disputeReturnReversalsPending: pendingList });

	await ctx.scheduler.runAfter(0, internal.disputeActions.reverseRecoveryTransfer, {
		paymentId: payment._id,
		stripeTransferId,
		/** Only the new part. */
		amount: delta,
		cumulative: targetReversal,
		label: input.label,
	});
	return delta;
}

/**
 * Record how much of a standalone transfer has been reversed, cumulatively.
 *
 * Written only once Stripe confirms the reversal, so a failed reversal leaves
 * the previous total in place and the next refund delivery — or an operator —
 * can try again for the same target.
 */
export const markReturnReversalInternal = internalMutation({
	args: {
		/** Set for a refund claw-back, which is scoped to one payment. */
		paymentId: v.optional(v.id(TABLE.PAYMENTS)),
		/** Set instead for an over-sized return transfer, which is scoped to the row. */
		recoveryId: v.optional(v.id(TABLE.DISPUTE_RECOVERIES)),
		stripeTransferId: v.string(),
		/** The new cumulative total reversed out of that transfer. */
		cumulative: v.number(),
		stripeTransferReversalId: v.string(),
	},
	handler: async (ctx, args): Promise<void> => {
		// The excess-return case: the row, not a payment, is what tracks it.
		if (args.recoveryId) {
			const recovery = await ctx.db.get(args.recoveryId);
			if (!recovery) return;
			if ((recovery.returnExcessReversed ?? 0) >= args.cumulative) return;

			const now = Date.now();
			await ctx.db.patch(recovery._id, {
				returnExcessReversed: args.cumulative,
				returnedAmount: Math.max(0, (recovery.returnedAmount ?? 0) - args.cumulative),
				updatedAt: now,
			});
			await appendAuditEvent(ctx, {
				aggregateType: TABLE.DISPUTE_RECOVERIES,
				aggregateId: recovery._id,
				eventType: AUDIT_EVENT.DISPUTE_RETURN_REVERSED,
				restaurantId: recovery.restaurantId,
				payload: {
					stripeDisputeId: recovery.stripeDisputeId,
					stripeTransferId: args.stripeTransferId,
					stripeTransferReversalId: args.stripeTransferReversalId,
					reversedTotal: args.cumulative,
					reason: "return exceeded the trimmed ledger row",
					currency: recovery.currency,
				},
				userId: AUDIT_SYSTEM_USER_ID,
				idempotencyKey: `dispute_return_excess_reversed:${recovery.stripeDisputeId}:${args.cumulative}`,
			});
			return;
		}

		if (!args.paymentId) return;
		const payment = await ctx.db.get(args.paymentId);
		if (!payment) return;

		const reversals = [...(payment.disputeReturnReversals ?? [])];
		const index = reversals.findIndex((r) => r.stripeTransferId === args.stripeTransferId);
		if (index >= 0) {
			// Never let a late delivery lower the total: the money is reversed.
			if (reversals[index].amount >= args.cumulative) return;
			reversals[index] = { stripeTransferId: args.stripeTransferId, amount: args.cumulative };
		} else {
			reversals.push({ stripeTransferId: args.stripeTransferId, amount: args.cumulative });
		}

		const now = Date.now();
		await ctx.db.patch(payment._id, {
			disputeReturnReversals: reversals,
			// The pending entry has served its purpose: `confirmed` now carries
			// the same figure, so leaving it would only be a second copy that
			// could drift.
			disputeReturnReversalsPending: dropPendingEntry(payment, args.stripeTransferId),
			updatedAt: now,
			updatedBy: AUDIT_SYSTEM_USER_ID,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.PAYMENTS,
			aggregateId: payment._id,
			eventType: AUDIT_EVENT.DISPUTE_RETURN_REVERSED,
			restaurantId: payment.restaurantId,
			payload: {
				stripeTransferId: args.stripeTransferId,
				stripeTransferReversalId: args.stripeTransferReversalId,
				reversedTotal: args.cumulative,
				currency: payment.currency,
			},
			userId: AUDIT_SYSTEM_USER_ID,
			idempotencyKey: `dispute_return_reversed:${payment._id}:${args.stripeTransferId}:${args.cumulative}`,
		});
	},
});

/**
 * What a return transfer is actually worth **right now** (TAVLI-102, review
 * round 3).
 *
 * The return is scheduled from a mutation that knows `recovered` at that
 * instant, and the ledger can move before the action runs: a refund on one of
 * the payments that drew this row down trims `recovered`, and the trim happens
 * precisely because no transfer had gone out yet. An action that transferred
 * its frozen argument would send the pre-trim figure and leak the difference,
 * silently and with nothing to alert on.
 *
 * So the action re-reads through this and transfers what the row says now.
 */
export const getRecoveryForReturnInternal = internalQuery({
	args: { recoveryId: v.id(TABLE.DISPUTE_RECOVERIES) },
	handler: async (
		ctx,
		args
	): Promise<{
		recovered: number;
		currency: string;
		stripeDisputeId: string;
		returnedAt: number | undefined;
	} | null> => {
		const recovery = await ctx.db.get(args.recoveryId);
		if (!recovery) return null;
		return {
			recovered: recovery.recovered,
			currency: recovery.currency,
			stripeDisputeId: recovery.stripeDisputeId,
			returnedAt: recovery.returnedAt,
		};
	},
});

/** The pending list with one transfer's entry removed, or `undefined` when empty. */
function dropPendingEntry(
	payment: Doc<"payments">,
	stripeTransferId: string
): { stripeTransferId: string; amount: number }[] | undefined {
	const remaining = (payment.disputeReturnReversalsPending ?? []).filter(
		(entry) => entry.stripeTransferId !== stripeTransferId
	);
	return remaining.length > 0 ? remaining : undefined;
}

/**
 * Forget a reversal slice that never happened (TAVLI-102, review round 4).
 *
 * The pending entry exists so two refunds in quick succession each send only
 * their own delta. But it is written at scheduling, before Stripe has agreed to
 * anything — so a slice that then FAILS would stay on the record as if it had
 * gone through, and the next, larger target would compute its delta from it.
 * A failed 200 followed by a full refund would send 300 while recording 500,
 * overstating what Stripe actually reversed by exactly the slice that failed.
 *
 * Rolling the entry back to the confirmed amount is what makes the next target
 * recompute from reality: one reversal then covers both slices.
 */
export const rollBackPendingReversalInternal = internalMutation({
	args: {
		paymentId: v.id(TABLE.PAYMENTS),
		stripeTransferId: v.string(),
	},
	handler: async (ctx, args): Promise<void> => {
		const payment = await ctx.db.get(args.paymentId);
		if (!payment) return;

		const confirmed =
			payment.disputeReturnReversals?.find(
				(entry) => entry.stripeTransferId === args.stripeTransferId
			)?.amount ?? 0;

		const pending = dropPendingEntry(payment, args.stripeTransferId) ?? [];
		// Back to whatever Stripe has actually confirmed — which is nothing at
		// all for a first slice, so the entry simply goes.
		const next =
			confirmed > 0
				? [...pending, { stripeTransferId: args.stripeTransferId, amount: confirmed }]
				: pending;

		await ctx.db.patch(payment._id, {
			disputeReturnReversalsPending: next.length > 0 ? next : undefined,
			updatedAt: Date.now(),
			updatedBy: AUDIT_SYSTEM_USER_ID,
		});
	},
});

/**
 * Mark a reinstated row's return transfer as settled.
 *
 * The Stripe transfer carries `dispute-recovery-return:${disputeId}` as its
 * idempotency key, so Stripe itself refuses a second transfer; this is the
 * in-app half, so our own records agree and the operator can see the transfer
 * id beside the dispute.
 */
export const markRecoveryReturnedInternal = internalMutation({
	args: {
		recoveryId: v.id(TABLE.DISPUTE_RECOVERIES),
		stripeTransferId: v.string(),
		amount: v.number(),
	},
	handler: async (ctx, args): Promise<void> => {
		const recovery = await ctx.db.get(args.recoveryId);
		if (!recovery || recovery.returnedAt !== undefined) return;

		// The transfer may have reached Stripe just before a refund trimmed the
		// row. Nothing can lower a transfer that has left — it can only be
		// reversed — so reverse the excess rather than record a payout larger
		// than the row says is owed. The action re-reads the row before
		// transferring, so this is the narrow window where it read the old
		// figure; it is belt and braces, not the primary defence.
		const excess = args.amount - recovery.recovered;
		if (excess > 0) {
			const alreadyReversed = recovery.returnExcessReversed ?? 0;
			if (excess > alreadyReversed) {
				await ctx.scheduler.runAfter(0, internal.disputeActions.reverseRecoveryTransfer, {
					recoveryId: recovery._id,
					stripeTransferId: args.stripeTransferId,
					amount: excess - alreadyReversed,
					cumulative: excess,
					label: `dispute ${recovery.stripeDisputeId} return excess`,
				});
			}
		}

		const now = Date.now();
		await ctx.db.patch(recovery._id, {
			returnedAt: now,
			returnedAmount: args.amount,
			stripeTransferId: args.stripeTransferId,
			updatedAt: now,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.DISPUTE_RECOVERIES,
			aggregateId: recovery._id,
			eventType: AUDIT_EVENT.DISPUTE_RECOVERY_RETURNED,
			restaurantId: recovery.restaurantId,
			payload: {
				stripeDisputeId: recovery.stripeDisputeId,
				stripeTransferId: args.stripeTransferId,
				amount: args.amount,
				currency: recovery.currency,
			},
			userId: AUDIT_SYSTEM_USER_ID,
			idempotencyKey: `dispute_recovery_returned:${recovery.stripeDisputeId}`,
		});
	},
});

// ============================================================================
// The write-off sweep
// ============================================================================

/** Rows written off per run. Bounded so one cron tick cannot blow a transaction. */
const WRITE_OFF_BATCH_SIZE = 50;

/**
 * Write off losses older than `DISPUTE_RECOVERY_WRITE_OFF_DAYS`.
 *
 * **A cron, not lazy-on-read.** Lazy evaluation would only ever touch rows the
 * deduction query happens to read — and that query does not run at all for a
 * restaurant with `disputeRecoveryPercent: 0`, which is every restaurant by
 * default. Those are precisely the ledgers whose rows can never be paid down,
 * so under a lazy scheme their debt would sit at "outstanding" forever, be
 * reported as recoverable on the payments page, and quietly start deducting the
 * day somebody switched recovery on years later. The sweep is one bounded range
 * read on `by_status_lost` per day.
 */
export const sweepDisputeWriteOffs = internalMutation({
	args: {},
	handler: async (
		ctx
	): Promise<{ writtenOff: number; reScheduled: number; shortfallsReScheduled: number }> => {
		const now = Date.now();
		const cutoff = writeOffCutoff(now);

		const due = await ctx.db
			.query(TABLE.DISPUTE_RECOVERIES)
			.withIndex("by_status_lost", (q) =>
				q.eq("status", DISPUTE_RECOVERY_STATUS.OUTSTANDING).lt("lostAt", cutoff)
			)
			.take(WRITE_OFF_BATCH_SIZE);

		for (const row of due) {
			await ctx.db.patch(row._id, {
				status: DISPUTE_RECOVERY_STATUS.WRITTEN_OFF,
				writtenOffAt: now,
				updatedAt: now,
			});

			await appendAuditEvent(ctx, {
				aggregateType: TABLE.DISPUTE_RECOVERIES,
				aggregateId: row._id,
				eventType: AUDIT_EVENT.DISPUTE_RECOVERY_WRITTEN_OFF,
				restaurantId: row.restaurantId,
				payload: {
					stripeDisputeId: row.stripeDisputeId,
					// `outstanding` is left as it was: the row keeps saying how much
					// was never recovered, and `status` is what stops it deducting.
					absorbed: row.outstanding,
					recovered: row.recovered,
					currency: row.currency,
					lostAt: row.lostAt,
				},
				userId: AUDIT_SYSTEM_USER_ID,
				idempotencyKey: `dispute_recovery_written_off:${row.stripeDisputeId}`,
			});

			// Info, not severe: nothing is broken and nobody has to act. It is a
			// number Tavli should see in its own accounting.
			await raiseOperatorAlert(ctx, {
				kind: OPERATOR_ALERT_KIND.DISPUTE_LOST,
				severity: OPERATOR_ALERT_SEVERITY.INFO,
				restaurantId: row.restaurantId,
				stripeObjectId: row.stripeDisputeId,
				dedupeKey: `dispute_recovery_written_off:${row.stripeDisputeId}`,
			});
		}

		const reScheduled = await rescheduleUnreturnedReturns(ctx);
		const shortfallsReScheduled = await rescheduleUnpaidShortfalls(ctx);

		return { writtenOff: due.length, reScheduled, shortfallsReScheduled };
	},
});

/**
 * Re-schedule return transfers that never settled.
 *
 * Convex does **not** retry a scheduled function that throws, so a
 * `transfers.create` that failed — Stripe down, a connected account briefly
 * unable to receive — leaves a reinstated row that still owes the restaurant
 * money, with its managers already told the money was on its way back. The
 * operator alert raised in the action's catch makes that visible; this makes it
 * self-healing.
 *
 * Safe to run daily because the transfer carries
 * `dispute-recovery-return:<disputeId>` as its Stripe idempotency key: a
 * re-schedule for a transfer that did go through returns Stripe's record of it,
 * and `markRecoveryReturnedInternal` then stamps the row so the next sweep
 * skips it.
 *
 * One exact index probe, not a scan: `by_status_returned` on
 * `(status, returnedAt)` with `returnedAt: undefined` is precisely "reinstated
 * and not yet paid back".
 */
async function rescheduleUnreturnedReturns(ctx: MutationCtx): Promise<number> {
	const pending = await ctx.db
		.query(TABLE.DISPUTE_RECOVERIES)
		.withIndex("by_status_returned", (q) =>
			q.eq("status", DISPUTE_RECOVERY_STATUS.REINSTATED).eq("returnedAt", undefined)
		)
		.take(WRITE_OFF_BATCH_SIZE);

	const now = Date.now();
	let scheduled = 0;
	for (const row of pending) {
		if (row.recovered <= 0) continue;
		// Do not race a run that is still working. Two concurrent
		// `transfers.create` calls share one idempotency key and the loser fails
		// with `idempotency_key_in_use` — harmless in itself, but it used to
		// raise a severe alert about a transfer that was in fact succeeding.
		if (
			row.returnScheduledAt !== undefined &&
			now - row.returnScheduledAt < DISPUTE_RETURN_RESCHEDULE_AFTER_MS
		) {
			continue;
		}

		const restaurant = await ctx.db.get(row.restaurantId);
		if (!isPayableConnectedAccount(restaurant)) {
			await raiseOperatorAlert(ctx, {
				kind: OPERATOR_ALERT_KIND.DISPUTE_LOST,
				severity: OPERATOR_ALERT_SEVERITY.SEVERE,
				restaurantId: row.restaurantId,
				stripeObjectId: row.stripeDisputeId,
				dedupeKey: `dispute_recovery_return_blocked:${row.stripeDisputeId}`,
			});
			continue;
		}

		await ctx.db.patch(row._id, { returnScheduledAt: now, updatedAt: now });
		await ctx.scheduler.runAfter(0, internal.disputeActions.returnRecoveredFunds, {
			recoveryId: row._id,
			stripeAccountId: restaurant.stripeAccountId,
			stripeDisputeId: row.stripeDisputeId,
			amount: row.recovered,
			currency: row.currency,
		});
		scheduled++;
	}
	return scheduled;
}

/**
 * Whether a connected account can receive a transfer right now.
 *
 * A **closed** account cannot, and Stripe answers with an error rather than
 * holding the money — so scheduling one is a guaranteed failed action plus a
 * severe alert that says nothing useful. The caller alerts once, with a key
 * that names what is stuck, and stops trying.
 */
function isPayableConnectedAccount(
	restaurant: Doc<"restaurants"> | null
): restaurant is Doc<"restaurants"> & { stripeAccountId: string } {
	if (!restaurant?.stripeAccountId) return false;
	return restaurant.stripeAccountStatus !== STRIPE_ACCOUNT_STATUS.CLOSED;
}

/**
 * Re-schedule shortfall transfers that never settled (TAVLI-102, review round
 * 2).
 *
 * Same story as the returns: the action that owed the restaurant money threw,
 * Convex did not retry it, and an alert alone leaves the money on the platform
 * balance until somebody acts on it. `by_shortfall_pending` is an exact probe —
 * the flag is only ever `true` or absent — so this reads the handful of
 * payments that owe a transfer, never a range over the payments table.
 */
async function rescheduleUnpaidShortfalls(ctx: MutationCtx): Promise<number> {
	const pending = await ctx.db
		.query(TABLE.PAYMENTS)
		.withIndex("by_shortfall_pending", (q) => q.eq("disputeRecoveryShortfallPending", true))
		.take(WRITE_OFF_BATCH_SIZE);

	let scheduled = 0;
	for (const payment of pending) {
		const amount = payment.disputeRecoveryShortfall ?? 0;
		if (amount <= 0 || payment.disputeRecoveryShortfallReturnedAt !== undefined) {
			await ctx.db.patch(payment._id, { disputeRecoveryShortfallPending: undefined });
			continue;
		}

		const restaurant = await ctx.db.get(payment.restaurantId);
		if (!isPayableConnectedAccount(restaurant)) {
			await raiseOperatorAlert(ctx, {
				kind: OPERATOR_ALERT_KIND.DISPUTE_LOST,
				severity: OPERATOR_ALERT_SEVERITY.SEVERE,
				restaurantId: payment.restaurantId,
				paymentId: payment._id,
				dedupeKey: `dispute_recovery_shortfall_blocked:${payment._id}`,
			});
			continue;
		}

		await ctx.scheduler.runAfter(0, internal.disputeActions.returnRecoveryShortfall, {
			paymentId: payment._id,
			stripeAccountId: restaurant.stripeAccountId,
			amount,
			currency: payment.currency,
		});
		scheduled++;
	}
	return scheduled;
}

// ============================================================================
// The disputes surface
// ============================================================================

/** One dispute as a manager reads it. */
export type DisputeListRow = {
	_id: Id<typeof TABLE.STRIPE_DISPUTES>;
	stripeDisputeId: string;
	/** The **normalized** status — never Stripe's raw string. */
	status: DisputeStatus;
	/** Stripe's reason code, which the UI maps to copy. */
	reason: string;
	amount: number;
	currency: string;
	openedAt: number | undefined;
	closedAt: number | undefined;
	reinstatedAt: number | undefined;
	orderId: Id<"orders"> | null;
	/** The order's per-day number, which is what staff call an order. */
	dailyOrderNumber: number | null;
	/** Money still owed on this dispute's ledger row, when one exists. */
	outstanding: number;
	/** Money already drawn back from later payments. */
	recovered: number;
	recoveryStatus: DisputeRecoveryStatus | null;
};

/** The recovery position shown above the list. */
export type DisputeRecoverySummary = {
	/** The restaurant's configured percentage, 0 when recovery is off. */
	percent: number;
	/** Σ outstanding across the ledger. */
	totalOutstanding: number;
	/** Σ recovered across the ledger. */
	totalRecovered: number;
	currency: string;
};

export type DisputesPageData = {
	rows: DisputeListRow[];
	recovery: DisputeRecoverySummary;
	/** True for platform admins — the UI shows the ledger detail to them only. */
	isAdmin: boolean;
};

type DisputesAccessErrors =
	| NotAuthenticatedErrorObject
	| NotAuthorizedErrorObject
	| NotFoundErrorObject;

/**
 * Every dispute of one restaurant, newest first, with its recovery position.
 *
 * Gated on `requireRestaurantManagerOrAbove`, the same gate as the payments
 * page this renders on: a dispute is the restaurant's money and an employee has
 * no business reading it. Stripe's raw `status` never leaves this function —
 * the row carries the normalized one, so a status Stripe invents next year
 * cannot reach a manager's screen as an identifier.
 */
export const listByRestaurant = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async function (ctx, args): AsyncReturn<DisputesPageData, DisputesAccessErrors> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];

		const [restaurant, accessError] = await requireRestaurantManagerOrAbove(
			ctx,
			userId,
			args.restaurantId
		);
		if (accessError) return [null, accessError];

		const [, adminError] = await requireAdminRole(ctx, userId);

		const disputes = await ctx.db
			.query(TABLE.STRIPE_DISPUTES)
			.withIndex("by_restaurant", (q) => q.eq("restaurantId", args.restaurantId))
			.order("desc")
			.take(DISPUTES_LIST_LIMIT);

		const rows: DisputeListRow[] = [];
		for (const dispute of disputes) {
			const recovery = await readRecoveryForDispute(ctx, dispute.stripeDisputeId);
			const order = dispute.orderId ? await ctx.db.get(dispute.orderId) : null;
			rows.push({
				_id: dispute._id,
				stripeDisputeId: dispute.stripeDisputeId,
				status: normalizeDisputeStatus(dispute.status),
				reason: dispute.reason,
				amount: dispute.amount,
				currency: dispute.currency.toUpperCase(),
				openedAt: dispute.openedAt,
				closedAt: dispute.closedAt,
				reinstatedAt: dispute.reinstatedAt,
				orderId: dispute.orderId ?? null,
				dailyOrderNumber: order?.dailyOrderNumber ?? null,
				outstanding: recovery?.outstanding ?? 0,
				recovered: recovery?.recovered ?? 0,
				recoveryStatus: recovery?.status ?? null,
			});
		}

		return [
			{
				rows,
				recovery: {
					percent: clampDisputeRecoveryPercent(restaurant.disputeRecoveryPercent),
					totalOutstanding: rows.reduce((sum, row) => sum + row.outstanding, 0),
					totalRecovered: rows.reduce((sum, row) => sum + row.recovered, 0),
					currency: rows[0]?.currency ?? restaurant.currency.toUpperCase(),
				},
				isAdmin: adminError === null,
			},
			null,
		];
	},
});

// ============================================================================
// The admin controls
// ============================================================================

/**
 * Set how much of a restaurant's later orders pays back its lost disputes.
 *
 * Platform admins only — this is a commercial term, not a restaurant setting,
 * and the restaurant's own owner must not be able to set it to zero the day a
 * chargeback lands. The validator refuses anything but a whole 0..cap, so the
 * admin input's own bound is a convenience and this is the rule.
 */
export const setDisputeRecoveryPercent = mutation({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		percent: v.number(),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<{ percent: number }, NotAuthenticatedErrorObject | NotAuthorizedErrorObject> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];

		const [, adminError] = await requireAdminRole(ctx, userId);
		if (adminError) return [null, adminError];

		// A stable code, not prose: the admin control maps it to bilingual copy,
		// and the same refusal has to read identically whether it came from the
		// input's own bound or from a caller that skipped the UI entirely.
		if (!isValidDisputeRecoveryPercent(args.percent)) {
			throw fromErrorObject(new ConflictError(DISPUTE_ERRORS.RECOVERY_PERCENT_INVALID).toObject());
		}

		const restaurant = await ctx.db.get(args.restaurantId);
		if (!restaurant) {
			throw fromErrorObject(new NotFoundError("Restaurant not found").toObject());
		}

		const previous = clampDisputeRecoveryPercent(restaurant.disputeRecoveryPercent);
		await ctx.db.patch(args.restaurantId, {
			disputeRecoveryPercent: args.percent,
			updatedAt: Date.now(),
			updatedBy: userId,
		});

		await appendAuditEvent(ctx, {
			aggregateType: TABLE.RESTAURANTS,
			aggregateId: args.restaurantId,
			eventType: AUDIT_EVENT.DISPUTE_RECOVERY_PERCENT_CHANGED,
			restaurantId: args.restaurantId,
			payload: { from: previous, to: args.percent },
			userId,
		});

		return [{ percent: args.percent }, null];
	},
});

/** The current percentage plus its bounds, for the admin control. */
export type DisputeRecoverySettings = {
	percent: number;
	maxPercent: number;
	defaultPercent: number;
};

export const getDisputeRecoverySettings = query({
	args: { restaurantId: v.id(TABLE.RESTAURANTS) },
	handler: async function (
		ctx,
		args
	): AsyncReturn<DisputeRecoverySettings, NotAuthenticatedErrorObject | NotAuthorizedErrorObject> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];

		const [, adminError] = await requireAdminRole(ctx, userId);
		if (adminError) return [null, adminError];

		const restaurant = await ctx.db.get(args.restaurantId);
		return [
			{
				percent: clampDisputeRecoveryPercent(restaurant?.disputeRecoveryPercent),
				maxPercent: DISPUTE_RECOVERY_MAX_PERCENT,
				defaultPercent: DISPUTE_RECOVERY_DEFAULT_PERCENT,
			},
			null,
		];
	},
});

/** What the invariants/alerts admin area reads off the aggregates. */
export type DisputeAggregatesReport = {
	/** `YYYY-MM` the fee figures cover. */
	month: string;
	platformFees: DisputeOutcomeTotals;
	perRestaurant: Record<string, DisputeOutcomeTotals>;
};

/**
 * The aggregates, for a platform admin.
 *
 * A query rather than a page: the invariants area already renders admin-only
 * numbers, and these are two `O(log n)` reads per bucket rather than a scan —
 * which is the entire reason the aggregates exist instead of a `.collect()`
 * over every dispute Tavli has ever seen.
 */
export const getDisputeAggregates = query({
	args: {
		restaurantId: v.id(TABLE.RESTAURANTS),
		/** `YYYY-MM`. Defaults to the current UTC month. */
		month: v.optional(v.string()),
	},
	handler: async function (
		ctx,
		args
	): AsyncReturn<DisputeAggregatesReport, NotAuthenticatedErrorObject | NotAuthorizedErrorObject> {
		const [userId, authError] = await getCurrentUserId(ctx);
		if (authError) return [null, authError];

		const [, adminError] = await requireAdminRole(ctx, userId);
		if (adminError) return [null, adminError];

		const month = args.month ?? disputeFeeMonthKey(Date.now());
		return [
			{
				month,
				platformFees: await readDisputeFeesForMonth(ctx, month),
				perRestaurant: await readRestaurantDisputeTotals(ctx, args.restaurantId),
			},
			null,
		];
	},
});
