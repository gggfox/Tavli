/**
 * The two dispute aggregates (TAVLI-102).
 *
 * Both are `DirectAggregate`s rather than `TableAggregate`s, and that is the
 * whole design decision worth explaining. A `TableAggregate` follows one table
 * with one sort key, computed from the document. Neither of these numbers is
 * that shape:
 *
 * - **Dispute fees** are Tavli's own cost, keyed by the *calendar month of the
 *   balance transaction*, which is Stripe's clock and not a field any of our
 *   rows is sorted by. A dispute row can also acquire its fee long after it was
 *   inserted, which a table aggregate would have to model as a key change.
 * - **Per-restaurant totals** count the same dispute under up to four different
 *   outcomes (opened, then lost, then possibly won), and `recovered` grows over
 *   time as later payments draw the ledger down. One row, several aggregate
 *   entries, one of which mutates — not a function of a document.
 *
 * Every write here is idempotent (`insertIfDoesNotExist` / `replaceOrInsert`),
 * because every caller is a Stripe webhook handler and Stripe redelivers. The
 * entry ids are derived from the Stripe dispute id for the same reason: a
 * replay lands on the entry it already wrote instead of adding a second one.
 *
 * Keeping the aggregates in step with the ledger is the job of the mutations
 * that change it — `convex/disputes.ts` calls these helpers in the same
 * transaction as the row write, so a query can never read a total that
 * disagrees with the rows behind it.
 */
import { DirectAggregate } from "@convex-dev/aggregate";
import { components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { disputeFeeMonthKey } from "./disputeRecoveryHelpers";

/** Read-or-write context, so a query can total without a mutation. */
type AggregateReadCtx = QueryCtx | MutationCtx;

/**
 * Platform dispute fees, keyed `YYYY-MM` (UTC), id = the Stripe dispute id,
 * `sumValue` = the fee in the smallest currency unit.
 */
export const disputeFeesByMonth = new DirectAggregate<{
	Key: string;
	Id: string;
}>(components.disputeFeesByMonth);

/**
 * What a restaurant's disputes add up to. Namespace = restaurant id,
 * key = `[outcome, whenMs]`, `sumValue` = the money that outcome moved.
 *
 * The timestamp is in the key (not just the id) so an operator can ask for "the
 * disputes this restaurant lost in Q3" as a bounded range rather than a scan.
 */
export const disputeTotalsByRestaurant = new DirectAggregate<{
	Namespace: string;
	Key: [string, number];
	Id: string;
}>(components.disputeTotalsByRestaurant);

/**
 * The four things a restaurant's disputes can be counted under.
 *
 * `RECOVERED` is different in kind from the other three: it is not an event,
 * it is a running total that grows every time a settled payment draws the
 * ledger down, which is why its entry is written with `replaceOrInsert` while
 * the others are written once.
 */
export const DISPUTE_OUTCOME = {
	OPENED: "opened",
	LOST: "lost",
	WON: "won",
	RECOVERED: "recovered",
} as const;

export type DisputeOutcome = (typeof DISPUTE_OUTCOME)[keyof typeof DISPUTE_OUTCOME];

export const DISPUTE_OUTCOMES = Object.values(DISPUTE_OUTCOME);

/** One dispute's entry id under one outcome. Stable across redeliveries. */
function outcomeEntryId(outcome: DisputeOutcome, stripeDisputeId: string): string {
	return `${outcome}:${stripeDisputeId}`;
}

/**
 * Count one dispute under one outcome for one restaurant, once.
 *
 * A redelivered `charge.dispute.created` calls this again with the same id and
 * the aggregate is unchanged — `insertIfDoesNotExist` is what makes "the number
 * of disputes opened" a fact rather than a count of webhook deliveries.
 */
export async function recordDisputeOutcome(
	ctx: MutationCtx,
	args: {
		restaurantId: Id<"restaurants">;
		stripeDisputeId: string;
		outcome: DisputeOutcome;
		/** Disputed amount, smallest currency unit. */
		amount: number;
		/** When it happened (ms) — part of the key, so ranges by time work. */
		whenMs: number;
	}
): Promise<void> {
	await disputeTotalsByRestaurant.insertIfDoesNotExist(ctx, {
		namespace: args.restaurantId,
		key: [args.outcome, args.whenMs],
		id: outcomeEntryId(args.outcome, args.stripeDisputeId),
		sumValue: args.amount,
	});
}

/**
 * Set the running `recovered` total for one dispute.
 *
 * `replaceOrInsert` with a stable key, so the first draw-down inserts and every
 * later one overwrites. The caller passes the **cumulative** figure off the
 * ledger row, never a delta: a delta would need the aggregate to be read back
 * and re-added, which is exactly the read-modify-write a replayed webhook would
 * double.
 */
export async function recordRecoveredTotal(
	ctx: MutationCtx,
	args: {
		restaurantId: Id<"restaurants">;
		stripeDisputeId: string;
		/** Total recovered so far for this dispute. */
		recovered: number;
		/** The dispute's `lostAt`, so the entry sorts with its loss. */
		lostAt: number;
	}
): Promise<void> {
	const id = outcomeEntryId(DISPUTE_OUTCOME.RECOVERED, args.stripeDisputeId);
	const key: [string, number] = [DISPUTE_OUTCOME.RECOVERED, args.lostAt];
	await disputeTotalsByRestaurant.replaceOrInsert(
		ctx,
		{ namespace: args.restaurantId, key, id },
		{ namespace: args.restaurantId, key, sumValue: args.recovered }
	);
}

/**
 * Record Tavli's dispute fee for one month, once per dispute.
 *
 * Called from the same mutation that writes `disputeFeeAmount` onto the dispute
 * row, and guarded there by that field being absent — so the fee is aggregated
 * exactly when it is first learned, and a later event carrying the same fee
 * changes nothing.
 */
export async function recordDisputeFee(
	ctx: MutationCtx,
	args: { stripeDisputeId: string; feeAmount: number; month: string }
): Promise<void> {
	await disputeFeesByMonth.insertIfDoesNotExist(ctx, {
		key: args.month,
		id: args.stripeDisputeId,
		sumValue: args.feeAmount,
	});
}

/**
 * Correct a fee already in the month's total.
 *
 * Reinstating a dispute's funds usually reinstates its fee too, which Stripe
 * posts as a negative balance transaction — so the summed fee falls, often to
 * zero. A net of zero (or less) is not "no fee recorded", it is "the fee came
 * back", and the entry has to leave the month rather than sit there as a cost
 * Tavli never bore.
 */
export async function correctDisputeFee(
	ctx: MutationCtx,
	args: { stripeDisputeId: string; month: string; feeAmount: number }
): Promise<void> {
	if (args.feeAmount > 0) {
		await disputeFeesByMonth.replaceOrInsert(
			ctx,
			{ key: args.month, id: args.stripeDisputeId },
			{ key: args.month, sumValue: args.feeAmount }
		);
		return;
	}
	await disputeFeesByMonth.deleteIfExists(ctx, {
		key: args.month,
		id: args.stripeDisputeId,
	});
}

/**
 * Drop one dispute's fee entry — the restaurant purge, which deletes the row
 * that knows which month the entry lives under.
 */
export async function removeDisputeFeeFromAggregate(
	ctx: MutationCtx,
	dispute: Doc<"stripeDisputes">
): Promise<void> {
	if (dispute.disputeFeeAmount === undefined) return;
	const month = dispute.disputeFeeMonth ?? disputeFeeMonthKey(dispute.createdAt);
	await disputeFeesByMonth.deleteIfExists(ctx, {
		key: month,
		id: dispute.stripeDisputeId,
	});
}

/**
 * Drop a whole restaurant's dispute totals — one call, because the aggregate is
 * namespaced by restaurant id. Used by the hard purge.
 */
export async function clearRestaurantDisputeTotals(
	ctx: MutationCtx,
	restaurantId: Id<"restaurants">
): Promise<void> {
	await disputeTotalsByRestaurant.clear(ctx, { namespace: restaurantId });
}

/** Count + money for one outcome, as the admin queries report it. */
export type DisputeOutcomeTotals = {
	count: number;
	amount: number;
};

/** Every outcome's totals for one restaurant, from four bounded reads. */
export async function readRestaurantDisputeTotals(
	ctx: AggregateReadCtx,
	restaurantId: Id<"restaurants">
): Promise<Record<DisputeOutcome, DisputeOutcomeTotals>> {
	const totals = {} as Record<DisputeOutcome, DisputeOutcomeTotals>;
	for (const outcome of DISPUTE_OUTCOMES) {
		const bounds = { prefix: [outcome] as [string] };
		totals[outcome] = {
			count: await disputeTotalsByRestaurant.count(ctx, { namespace: restaurantId, bounds }),
			amount: await disputeTotalsByRestaurant.sum(ctx, { namespace: restaurantId, bounds }),
		};
	}
	return totals;
}

/** Platform dispute fees for one `YYYY-MM`, as count and total. */
export async function readDisputeFeesForMonth(
	ctx: AggregateReadCtx,
	month: string
): Promise<DisputeOutcomeTotals> {
	const bounds = {
		lower: { key: month, inclusive: true },
		upper: { key: month, inclusive: true },
	} as const;
	return {
		count: await disputeFeesByMonth.count(ctx, { bounds }),
		amount: await disputeFeesByMonth.sum(ctx, { bounds }),
	};
}
