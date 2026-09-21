/**
 * Pure payout logic for the `payout.*` connected-account webhooks (TAVLI-103).
 *
 * Stripe pays a connected account's balance out to the restaurant's bank on a
 * schedule. A payout can fail — wrong CLABE, closed account, lapsed
 * verification — and Stripe then usually pauses the schedule. **The money is
 * not lost**: it sits in the connected account's balance until somebody fixes
 * the bank details. Before this ticket nobody at Tavli or at the restaurant
 * found out, because no `payout.*` handler existed anywhere.
 *
 * Everything here is deliberately free of Convex `ctx` and of the Stripe SDK
 * client, like `stripeWebhookHelpers.ts`: the three decisions that matter —
 * which failure the manager is shown, which of two deliveries wins, and how
 * much money is stuck — are plain functions on plain objects, so they are
 * pinned by `payoutHelpers.test.ts` without a harness. `convex/payouts.ts`
 * calls them and persists the result.
 */
import {
	PAYOUT_FAILURE_CODE,
	PAYOUT_FAILURE_CODES,
	STRIPE_PAYOUT_STATUS,
	STRIPE_PAYOUT_STATUSES,
	type PayoutFailureCode,
	type StripePayoutStatus,
} from "./constants";
import { stripeSecondsToMs } from "./stripeWebhookHelpers";

// ============================================================================
// Failure codes
// ============================================================================

const FAILURE_CODE_SET = new Set<string>(PAYOUT_FAILURE_CODES);

/**
 * Turn Stripe's raw `failure_code` into one of our closed set.
 *
 * Anything Stripe adds after this was written — and anything absent, blank or
 * oddly cased — becomes `unknown`, which has its own reassuring copy. This is
 * the single point that guarantees the promise in the ticket: a manager is
 * never shown a raw Stripe string. A pass-through fallback would have broken
 * that promise the first time Stripe shipped a new code, silently and in
 * production.
 */
export function normalizePayoutFailureCode(raw: string | null | undefined): PayoutFailureCode {
	const normalized = raw?.trim().toLowerCase();
	if (!normalized) return PAYOUT_FAILURE_CODE.UNKNOWN;
	return FAILURE_CODE_SET.has(normalized)
		? (normalized as PayoutFailureCode)
		: PAYOUT_FAILURE_CODE.UNKNOWN;
}

// ============================================================================
// Statuses
// ============================================================================

const STATUS_SET = new Set<string>(STRIPE_PAYOUT_STATUSES);

/**
 * What the event type alone implies, used when the payout object's own
 * `status` is missing or unrecognised. `payout.created` and `payout.updated`
 * say nothing on their own, so they fall back to `pending` — the lowest rank,
 * which `decidePayoutUpdate` then refuses to write over anything terminal.
 */
const STATUS_BY_EVENT_TYPE: Record<string, StripePayoutStatus> = {
	"payout.created": STRIPE_PAYOUT_STATUS.PENDING,
	"payout.updated": STRIPE_PAYOUT_STATUS.PENDING,
	"payout.paid": STRIPE_PAYOUT_STATUS.PAID,
	"payout.failed": STRIPE_PAYOUT_STATUS.FAILED,
	"payout.canceled": STRIPE_PAYOUT_STATUS.CANCELED,
};

/** The payout object's `status` when we recognise it, else the event type's. */
export function normalizePayoutStatus(
	raw: string | null | undefined,
	eventType: string
): StripePayoutStatus {
	const normalized = raw?.trim().toLowerCase();
	if (normalized && STATUS_SET.has(normalized)) return normalized as StripePayoutStatus;
	return STATUS_BY_EVENT_TYPE[eventType] ?? STRIPE_PAYOUT_STATUS.PENDING;
}

/**
 * How far along the lifecycle a status is.
 *
 * **This, not a timestamp, is what orders two deliveries about one payout.**
 * Stripe's `payout.created` field is the payout's own creation time and is
 * identical on every event about it, so it cannot separate them; and webhook
 * deliveries genuinely arrive out of order (retries, parallel workers), which
 * is exactly how a late `payout.created` would otherwise reset a `failed` row
 * to `pending` and make stuck money disappear from the held total.
 *
 * A single payout's status only ever advances: `pending` → `in_transit` →
 * one terminal state. Ranking those three stages and refusing to move
 * backwards is therefore both sufficient and exact — no extra column, and no
 * dependence on delivery timing.
 */
export const PAYOUT_STATUS_RANK: Record<StripePayoutStatus, number> = {
	[STRIPE_PAYOUT_STATUS.PENDING]: 0,
	[STRIPE_PAYOUT_STATUS.IN_TRANSIT]: 1,
	[STRIPE_PAYOUT_STATUS.PAID]: 2,
	[STRIPE_PAYOUT_STATUS.FAILED]: 2,
	[STRIPE_PAYOUT_STATUS.CANCELED]: 2,
};

export type PayoutUpdateDecision = {
	/** Whether the incoming event's fields should be written at all. */
	apply: boolean;
	/** The status the row should hold afterwards. */
	status: StripePayoutStatus;
	/** Two different terminal statuses for one payout — impossible, so worth a warning. */
	conflict: boolean;
};

/**
 * Whether an incoming event may overwrite what is stored for the same payout.
 *
 * - Higher rank → apply. The normal forward path.
 * - Same status → apply. Not a no-op: `payout.updated` can carry failure detail
 *   that the first `payout.failed` did not have yet.
 * - Same rank, different terminal status → keep what is stored and flag it.
 *   One payout cannot both be paid and refused; rather than pick, the caller
 *   logs it so a human decides.
 * - Lower rank → ignore. The out-of-order case above.
 */
export function decidePayoutUpdate(
	stored: { status: StripePayoutStatus },
	incoming: { status: StripePayoutStatus }
): PayoutUpdateDecision {
	const storedRank = PAYOUT_STATUS_RANK[stored.status];
	const incomingRank = PAYOUT_STATUS_RANK[incoming.status];

	if (incomingRank > storedRank) {
		return { apply: true, status: incoming.status, conflict: false };
	}
	if (incoming.status === stored.status) {
		return { apply: true, status: stored.status, conflict: false };
	}
	return {
		apply: false,
		status: stored.status,
		conflict: incomingRank === storedRank,
	};
}

// ============================================================================
// Event → facts
// ============================================================================

/**
 * Minimal structural view of a Stripe `Payout` as delivered on `payout.*`.
 * Structural rather than the SDK type so fixtures stay small.
 */
export interface PayoutInput {
	id: string;
	amount?: number | null;
	currency?: string | null;
	status?: string | null;
	created?: number | null;
	arrival_date?: number | null;
	failure_code?: string | null;
	failure_message?: string | null;
	failure_balance_transaction?: string | { id?: string | null } | null;
}

export interface PayoutFacts {
	stripePayoutId: string;
	/** Smallest currency unit, as Stripe reports it. */
	amount: number;
	/** Upper-cased to match `restaurants.currency` and the payments ledger. */
	currency: string;
	status: StripePayoutStatus;
	/** Stripe's `created` in ms — the payout's own date, which is what "newest first" means to a restaurant. */
	createdAt: number;
	/** Expected arrival at the bank, in ms. */
	arrivalDate: number | undefined;
	/** Normalized failure code; set only on a failed payout. */
	failureCode: PayoutFailureCode | undefined;
	/** Stripe's raw English sentence. Operators only — never rendered to a manager. */
	failureMessage: string | undefined;
	/** The balance transaction that returned the money to the balance. */
	failureBalanceTransaction: string | undefined;
}

/** Narrow the `string | { id } | null` shape Stripe uses for expandable refs. */
function refId(ref: PayoutInput["failure_balance_transaction"]): string | undefined {
	if (!ref) return undefined;
	if (typeof ref === "string") return ref;
	return typeof ref.id === "string" ? ref.id : undefined;
}

/**
 * The fields Tavli stores from one `payout.*` event.
 *
 * Failure fields are attached **only** when the resulting status is `failed`.
 * A `payout.paid` that happens to carry a stale `failure_code` (Stripe reuses
 * the object across its lifecycle) must not leave a "why it failed" line on a
 * payout that arrived.
 */
export function computePayoutFacts(payout: PayoutInput, eventType: string): PayoutFacts {
	const status = normalizePayoutStatus(payout.status, eventType);
	const isFailed = status === STRIPE_PAYOUT_STATUS.FAILED;

	return {
		stripePayoutId: payout.id,
		amount: payout.amount ?? 0,
		currency: (payout.currency ?? "").toUpperCase(),
		status,
		createdAt: stripeSecondsToMs(payout.created) ?? Date.now(),
		arrivalDate: stripeSecondsToMs(payout.arrival_date),
		// A failed payout with no code still needs a reason line, so it maps to
		// `unknown` rather than being left blank.
		failureCode: isFailed ? normalizePayoutFailureCode(payout.failure_code) : undefined,
		failureMessage: isFailed ? (payout.failure_message ?? undefined) : undefined,
		failureBalanceTransaction: isFailed ? refId(payout.failure_balance_transaction) : undefined,
	};
}

// ============================================================================
// Held total
// ============================================================================

/** The three fields the held total is computed from. */
export type HeldTotalInput = {
	stripePayoutId: string;
	amount: number;
	/** Stripe's payout `created`, in ms. */
	createdAt: number;
	status: StripePayoutStatus;
};

export type HeldTotal = {
	/** Smallest currency unit, still sitting in the connected account's balance. */
	heldCents: number;
	/** Which failed payouts make it up, newest first. */
	unresolvedPayoutIds: string[];
};

/**
 * How much of this restaurant's money is stuck in Stripe.
 *
 * **Stripe never retries a failed payout.** It creates a *new* payout the next
 * time the schedule runs, so a failed row stays `failed` forever and "is it
 * resolved?" cannot be read off that row. The rule this implements:
 *
 * > A failed payout is superseded by any **later** terminal payout that
 * > actually attempted the balance — another `failed`, or a `paid`. Only the
 * > unsuperseded failures are held, and a later `paid` therefore holds nothing.
 *
 * Both halves follow from one fact about how Tavli's money moves: **the
 * connected accounts are on an automatic schedule and Tavli never creates a
 * manual payout**, so every payout sweeps the *whole available balance*. That
 * balance already contains whatever bounced last time.
 *
 * - A later **`failed`** payout therefore already includes the earlier
 *   failure's money. Counting both double-counts: a 1,000 failure followed the
 *   next day by a 1,200 failure (the same 1,000 plus 200 of new sales) is
 *   1,200 stuck, not 2,200.
 * - A later **`paid`** payout resolves every earlier failure **regardless of
 *   its amount**. Requiring "at least as large" looks safe and is not: a refund
 *   or a lost dispute can shrink the balance between the failure and the
 *   recovery, and Stripe can settle the balance across two smaller payouts. In
 *   either case the money did leave, while an amount test would hold it on the
 *   page forever and — worse — suppress the `payouts_resumed` notification that
 *   tells the restaurant it is over.
 * - A `canceled` payout supersedes nothing: it never attempted the bank, so the
 *   money it would have carried is still stuck. `pending` and `in_transit` are
 *   not terminal and say nothing yet.
 *
 * The alternative the ticket weighed — treat `payouts_enabled` going true
 * again as resolution — was rejected: the capability can be re-enabled while
 * the bank account is still wrong (and Stripe re-enables it on verification,
 * not on a successful transfer), so it would tell a restaurant their money had
 * moved when it had not. Only money actually reaching a bank proves that.
 *
 * In practice the surviving set is the newest failure, or nothing. It can hold
 * more than one row only when two payouts were created at the very same instant
 * — a genuine split of one balance, where both amounts really are stuck.
 */
export function computeHeldTotal(rows: readonly HeldTotalInput[]): HeldTotal {
	const failures = rows
		.filter((row) => row.status === STRIPE_PAYOUT_STATUS.FAILED)
		.sort((a, b) => b.createdAt - a.createdAt);
	if (failures.length === 0) return { heldCents: 0, unresolvedPayoutIds: [] };

	// Terminal *and* attempted: `canceled` never reached the bank, so it leaves
	// the older failure's money exactly where it was.
	const attempted = rows.filter(
		(row) => row.status === STRIPE_PAYOUT_STATUS.FAILED || row.status === STRIPE_PAYOUT_STATUS.PAID
	);

	let heldCents = 0;
	const unresolvedPayoutIds: string[] = [];
	for (const failure of failures) {
		// Strictly later: a payout created at the same instant is a parallel
		// sweep of the same balance, not a re-sweep of it.
		const superseded = attempted.some((other) => other.createdAt > failure.createdAt);
		if (superseded) continue;
		heldCents += failure.amount;
		unresolvedPayoutIds.push(failure.stripePayoutId);
	}

	return { heldCents, unresolvedPayoutIds };
}

// ============================================================================
// Formatting for notification / email params
// ============================================================================

/**
 * Grouped, two-decimal amount for a notification's `messageParams`.
 *
 * Pinned to `en-US` for the same reason `src/global/utils/money.ts` is: both
 * locales Tavli ships group with `,` and use `.` for decimals, while `Intl`
 * would resolve a bare `"es"` to es-ES and render `1.234,56` — the wrong
 * convention for this market. The **currency code** travels as its own param
 * so the copy decides where to put it.
 */
const PAYOUT_AMOUNT_FORMATTER = new Intl.NumberFormat("en-US", {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

export function formatPayoutAmount(amountCents: number): string {
	return PAYOUT_AMOUNT_FORMATTER.format(amountCents / 100);
}
