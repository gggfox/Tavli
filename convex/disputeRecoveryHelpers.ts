/**
 * The arithmetic of recovering a lost dispute (TAVLI-102).
 *
 * Pure, Convex-free and Stripe-free, because these are the numbers that decide
 * how much of a restaurant's money we keep — the one place in this ticket that
 * must be readable and testable without a webhook fixture or a database.
 *
 * Three rules are encoded here and nowhere else:
 *
 * 1. **The deduction is capped twice**: by the configured percentage of the
 *    sale, and by what is actually still owed. Whichever is smaller wins, so a
 *    ledger can never be over-recovered and a single order can never be turned
 *    into a debt collection.
 * 2. **The tip is not part of the base.** `restaurantShare` is what Stripe
 *    would have transferred (subtotal + gratuity); `recoveryBase` is the food
 *    subtotal alone. Taking a percentage of the base and subtracting it from
 *    the share means the whole gratuity always reaches the restaurant — the
 *    same promise `convex/_shared/tip.ts` makes about the service fee.
 * 3. **Rounding is down.** A fractional cent of a deduction belongs to the
 *    restaurant, not to the platform.
 *
 * Draw-down is oldest-first (`planLedgerDrawDown`), which matters for the
 * write-off clock: paying the newest debt first would leave the oldest row to
 * age out at 180 days while money was flowing past it.
 */
import {
	DISPUTE_RECOVERY_MAX_PERCENT,
	DISPUTE_RECOVERY_WRITE_OFF_MS,
	DISPUTE_STATUS,
	type DisputeStatus,
} from "./constants";

/** Everything the deduction for one order payment depends on. */
export type DisputeDeductionInput = {
	/** What Stripe would transfer with no deduction: subtotal + gratuity. */
	restaurantShare: number;
	/** The part of that share the percentage applies to: the food subtotal. */
	recoveryBase: number;
	/** `restaurants.disputeRecoveryPercent`, whole percent. */
	percent: number;
	/** Σ `outstanding` over this restaurant's outstanding ledger rows. */
	totalOutstanding: number;
};

/**
 * How much of one order payment's transfer is withheld to pay back disputes.
 *
 * Returns 0 for every disabled, exhausted or nonsensical case, so the caller
 * can always subtract the result without branching. The `percent` is clamped
 * rather than trusted: this function is called with a value read from the
 * database, and a row written before the validator existed (or by a future
 * migration) must not be able to withhold more than the cap.
 */
export function computeDisputeDeduction(input: DisputeDeductionInput): number {
	const percent = clampDisputeRecoveryPercent(input.percent);
	if (percent === 0) return 0;

	const outstanding = Math.max(0, Math.floor(input.totalOutstanding));
	if (outstanding === 0) return 0;

	const base = Math.max(0, Math.floor(input.recoveryBase));
	const share = Math.max(0, Math.floor(input.restaurantShare));
	if (base === 0 || share === 0) return 0;

	// Rounded down: a fractional cent of recovery belongs to the restaurant.
	const capByPercent = Math.floor((base * percent) / 100);

	// `share` is the third cap and the reason a transfer can never go negative:
	// an order whose subtotal is large but whose share is small (an impossible
	// shape today, but one a future money model could produce) still cannot be
	// deducted below zero.
	return Math.min(outstanding, capByPercent, share);
}

/** One ledger row as the draw-down planner sees it. */
export type DrawDownRow = {
	id: string;
	outstanding: number;
	lostAt: number;
};

/** One leg of a draw-down: how much comes off which row. */
export type DrawDownLeg = {
	id: string;
	amount: number;
};

/**
 * Split `amount` across the ledger rows, oldest loss first.
 *
 * Oldest-first, not largest-first or newest-first, because the write-off clock
 * runs from `lostAt`: paying newer debts first would let the oldest row reach
 * 180 days and be written off while the restaurant was demonstrably paying.
 *
 * Rows are sorted here rather than trusted to arrive ordered — the caller reads
 * them from an index that already orders by `lostAt`, and sorting a handful of
 * rows again is cheaper than the class of bug where it silently does not.
 */
export function planLedgerDrawDown(
	rows: ReadonlyArray<DrawDownRow>,
	amount: number
): DrawDownLeg[] {
	let remaining = Math.max(0, Math.floor(amount));
	if (remaining === 0) return [];

	const legs: DrawDownLeg[] = [];
	const ordered = [...rows].sort((a, b) => a.lostAt - b.lostAt);

	for (const row of ordered) {
		if (remaining === 0) break;
		const available = Math.max(0, Math.floor(row.outstanding));
		if (available === 0) continue;
		const take = Math.min(available, remaining);
		legs.push({ id: row.id, amount: take });
		remaining -= take;
	}

	return legs;
}

/**
 * Whether a percentage is one an admin may store: a whole number from 0 to the
 * cap. The admin mutation rejects anything else with a stable error code — 51
 * is refused, and so is 12.5.
 */
export function isValidDisputeRecoveryPercent(percent: number): boolean {
	return Number.isInteger(percent) && percent >= 0 && percent <= DISPUTE_RECOVERY_MAX_PERCENT;
}

/**
 * Force a stored percentage into range. Used on the read side, where refusing
 * would mean refusing a payment: anything unusable becomes "no deduction".
 */
export function clampDisputeRecoveryPercent(percent: number | undefined): number {
	if (percent === undefined || !Number.isFinite(percent)) return 0;
	const rounded = Math.floor(percent);
	if (rounded <= 0) return 0;
	return Math.min(rounded, DISPUTE_RECOVERY_MAX_PERCENT);
}

const KNOWN_DISPUTE_STATUSES = new Set<string>(Object.values(DISPUTE_STATUS));

/**
 * Stripe's `dispute.status` narrowed to the closed set, so nothing Stripe adds
 * later can reach a manager's screen as a raw identifier — or, worse, be
 * compared against `"lost"` by accident.
 */
export function normalizeDisputeStatus(status: string | undefined | null): DisputeStatus {
	if (!status) return DISPUTE_STATUS.UNKNOWN;
	return KNOWN_DISPUTE_STATUSES.has(status) ? (status as DisputeStatus) : DISPUTE_STATUS.UNKNOWN;
}

/** The one status that costs money. Deliberately exact — no prefix matching. */
export function isDisputeLost(status: string | undefined | null): boolean {
	return normalizeDisputeStatus(status) === DISPUTE_STATUS.LOST;
}

/**
 * The statuses that mean the restaurant keeps the money.
 *
 * `warning_closed` counts: an early-warning dispute that closes was never a
 * chargeback at all, so no money left and there is nothing to recover — the
 * same outcome as `won` from the ledger's point of view.
 */
export function isDisputeWon(status: string | undefined | null): boolean {
	const normalized = normalizeDisputeStatus(status);
	return normalized === DISPUTE_STATUS.WON || normalized === DISPUTE_STATUS.WARNING_CLOSED;
}

/**
 * The fee aggregate's key for a moment in time: `YYYY-MM`, UTC.
 *
 * UTC rather than a restaurant's timezone because this is Tavli's own cost —
 * the number an operator reconciles against the Stripe balance, which Stripe
 * reports in UTC.
 */
export function disputeFeeMonthKey(ms: number): string {
	const date = new Date(ms);
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	return `${date.getUTCFullYear()}-${month}`;
}

/** Losses older than this are written off. */
export function writeOffCutoff(nowMs: number): number {
	return nowMs - DISPUTE_RECOVERY_WRITE_OFF_MS;
}
