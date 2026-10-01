/**
 * Pure payout logic (TAVLI-103): failure-code mapping, event ordering, and the
 * held total.
 *
 * These three are where the ticket's real decisions live, and all three are
 * plain functions on plain objects so they can be pinned without a Convex
 * harness or a Stripe client.
 */
import { describe, expect, it } from "vitest";
import {
	PAYOUT_FAILURE_CODE,
	PAYOUT_FAILURE_CODES,
	PAYOUT_FAILURE_FIX_KEY,
	PAYOUT_FAILURE_REASON_KEY,
	STRIPE_PAYOUT_STATUS,
} from "./constants";
import {
	computeHeldTotal,
	computePayoutFacts,
	decidePayoutUpdate,
	formatPayoutAmount,
	heldTotalPaidLowerBound,
	isPayoutReturn,
	normalizePayoutFailureCode,
	normalizePayoutStatus,
	type HeldTotalInput,
} from "./payoutHelpers";

/** Every failure code Stripe documents for `payout.failure_code`. */
const DOCUMENTED_STRIPE_FAILURE_CODES = [
	"account_closed",
	"account_frozen",
	"bank_account_restricted",
	"bank_ownership_changed",
	"could_not_process",
	"debit_not_authorized",
	"declined",
	"insufficient_funds",
	"invalid_account_number",
	"incorrect_account_holder_name",
	"incorrect_account_holder_address",
	"incorrect_account_holder_tax_id",
	"invalid_currency",
	"no_account",
	"unsupported_card",
] as const;

describe("normalizePayoutFailureCode", () => {
	it.each(DOCUMENTED_STRIPE_FAILURE_CODES)("maps the documented code %s to itself", (code) => {
		expect(normalizePayoutFailureCode(code)).toBe(code);
	});

	it("covers every documented code plus unknown, and nothing else", () => {
		expect(new Set(PAYOUT_FAILURE_CODES)).toEqual(
			new Set<string>([...DOCUMENTED_STRIPE_FAILURE_CODES, PAYOUT_FAILURE_CODE.UNKNOWN])
		);
	});

	it.each([
		["a code Stripe has not documented yet", "teleportation_declined"],
		["an empty string", ""],
		["whitespace", "   "],
	])("falls back to unknown for %s", (_label, raw) => {
		expect(normalizePayoutFailureCode(raw)).toBe(PAYOUT_FAILURE_CODE.UNKNOWN);
	});

	it.each([undefined, null])("falls back to unknown for %s", (raw) => {
		expect(normalizePayoutFailureCode(raw)).toBe(PAYOUT_FAILURE_CODE.UNKNOWN);
	});

	it("is case- and whitespace-insensitive, so casing drift cannot leak a raw string", () => {
		expect(normalizePayoutFailureCode("  Account_Closed ")).toBe(
			PAYOUT_FAILURE_CODE.ACCOUNT_CLOSED
		);
	});

	it("gives every code a reason key and a fix key", () => {
		for (const code of PAYOUT_FAILURE_CODES) {
			expect(PAYOUT_FAILURE_REASON_KEY[code], `no reason key for ${code}`).toBeTruthy();
			expect(PAYOUT_FAILURE_FIX_KEY[code], `no fix key for ${code}`).toBeTruthy();
		}
	});
});

describe("normalizePayoutStatus", () => {
	it.each(["pending", "in_transit", "paid", "failed", "canceled"])(
		"keeps Stripe's own status %s",
		(status) => {
			expect(normalizePayoutStatus(status, "payout.updated")).toBe(status);
		}
	);

	it.each([
		["payout.failed", STRIPE_PAYOUT_STATUS.FAILED],
		["payout.paid", STRIPE_PAYOUT_STATUS.PAID],
		["payout.canceled", STRIPE_PAYOUT_STATUS.CANCELED],
		["payout.created", STRIPE_PAYOUT_STATUS.PENDING],
		["payout.updated", STRIPE_PAYOUT_STATUS.PENDING],
	])("falls back to the event type's own meaning for %s", (eventType, expected) => {
		expect(normalizePayoutStatus(undefined, eventType)).toBe(expected);
	});

	it("prefers the event type over a status string it does not recognise", () => {
		expect(normalizePayoutStatus("quantum_superposition", "payout.failed")).toBe(
			STRIPE_PAYOUT_STATUS.FAILED
		);
	});
});

describe("computePayoutFacts", () => {
	it("reads the fields the payouts page and the operator both need", () => {
		const facts = computePayoutFacts(
			{
				id: "po_1",
				amount: 123456,
				currency: "mxn",
				status: "failed",
				created: 1_700_000_000,
				arrival_date: 1_700_200_000,
				failure_code: "no_account",
				failure_message: "The bank account could not be located.",
				failure_balance_transaction: "txn_1",
			},
			"payout.failed"
		);

		expect(facts).toMatchObject({
			stripePayoutId: "po_1",
			amount: 123456,
			// Upper-cased: every other money surface in Tavli stores "MXN".
			currency: "MXN",
			status: STRIPE_PAYOUT_STATUS.FAILED,
			createdAt: 1_700_000_000_000,
			arrivalDate: 1_700_200_000_000,
			failureCode: "no_account",
			failureMessage: "The bank account could not be located.",
			failureBalanceTransaction: "txn_1",
		});
	});

	it("keeps no failure fields on a payout that did not fail", () => {
		const facts = computePayoutFacts(
			{ id: "po_2", amount: 500, currency: "mxn", status: "paid", created: 1 },
			"payout.paid"
		);
		expect(facts.failureCode).toBeUndefined();
		expect(facts.failureMessage).toBeUndefined();
		expect(facts.failureBalanceTransaction).toBeUndefined();
	});

	it("dates a payout with no `created` to 0, so it can never supersede a real failure", () => {
		const facts = computePayoutFacts(
			{ id: "po_undated", amount: 500, currency: "mxn", status: "paid" },
			"payout.paid"
		);
		// `Date.now()` here would make this the newest event on the account and
		// silently resolve every outstanding failure.
		expect(facts.createdAt).toBe(0);
		expect(
			computeHeldTotal([
				{
					stripePayoutId: "po_failed",
					amount: 1000,
					createdAt: 10,
					status: STRIPE_PAYOUT_STATUS.FAILED,
				},
				{
					stripePayoutId: facts.stripePayoutId,
					amount: facts.amount,
					createdAt: facts.createdAt,
					status: facts.status,
				},
			]).heldCents
		).toBe(1000);
	});

	it("keeps a failed payout with no failure_code, mapped to unknown rather than dropped", () => {
		const facts = computePayoutFacts(
			{ id: "po_3", amount: 500, currency: "mxn", status: "failed", created: 1 },
			"payout.failed"
		);
		expect(facts.failureCode).toBe(PAYOUT_FAILURE_CODE.UNKNOWN);
	});
});

describe("decidePayoutUpdate", () => {
	it("advances pending → in_transit → paid", () => {
		expect(
			decidePayoutUpdate(
				{ status: STRIPE_PAYOUT_STATUS.PENDING },
				{ status: STRIPE_PAYOUT_STATUS.IN_TRANSIT }
			)
		).toEqual({ apply: true, status: STRIPE_PAYOUT_STATUS.IN_TRANSIT, conflict: false });
		expect(
			decidePayoutUpdate(
				{ status: STRIPE_PAYOUT_STATUS.IN_TRANSIT },
				{ status: STRIPE_PAYOUT_STATUS.PAID }
			)
		).toEqual({ apply: true, status: STRIPE_PAYOUT_STATUS.PAID, conflict: false });
	});

	it.each([STRIPE_PAYOUT_STATUS.PAID, STRIPE_PAYOUT_STATUS.FAILED, STRIPE_PAYOUT_STATUS.CANCELED])(
		"never lets a late pending event downgrade %s",
		(terminal) => {
			expect(
				decidePayoutUpdate({ status: terminal }, { status: STRIPE_PAYOUT_STATUS.PENDING })
			).toEqual({ apply: false, status: terminal, conflict: false });
			expect(
				decidePayoutUpdate({ status: terminal }, { status: STRIPE_PAYOUT_STATUS.IN_TRANSIT })
			).toEqual({ apply: false, status: terminal, conflict: false });
		}
	);

	it("re-applies the same status, so a payout.updated can add failure detail to a failed row", () => {
		expect(
			decidePayoutUpdate(
				{ status: STRIPE_PAYOUT_STATUS.FAILED },
				{ status: STRIPE_PAYOUT_STATUS.FAILED }
			)
		).toEqual({ apply: true, status: STRIPE_PAYOUT_STATUS.FAILED, conflict: false });
	});

	it("applies paid → failed: the bank returned a payout that had already shown paid", () => {
		// https://docs.stripe.com/payouts — a payout can be marked paid and still
		// fail days later. Keeping `paid` would tell the restaurant the money
		// arrived when it is back in the Stripe balance.
		expect(
			decidePayoutUpdate(
				{ status: STRIPE_PAYOUT_STATUS.PAID },
				{ status: STRIPE_PAYOUT_STATUS.FAILED }
			)
		).toEqual({ apply: true, status: STRIPE_PAYOUT_STATUS.FAILED, conflict: false });
		expect(
			isPayoutReturn({ status: STRIPE_PAYOUT_STATUS.PAID }, { status: STRIPE_PAYOUT_STATUS.FAILED })
		).toBe(true);
	});

	it("refuses failed → paid and flags it: Stripe never retries a failed payout", () => {
		expect(
			decidePayoutUpdate(
				{ status: STRIPE_PAYOUT_STATUS.FAILED },
				{ status: STRIPE_PAYOUT_STATUS.PAID }
			)
		).toEqual({ apply: false, status: STRIPE_PAYOUT_STATUS.FAILED, conflict: true });
		expect(
			isPayoutReturn({ status: STRIPE_PAYOUT_STATUS.FAILED }, { status: STRIPE_PAYOUT_STATUS.PAID })
		).toBe(false);
	});

	it.each([
		[STRIPE_PAYOUT_STATUS.CANCELED, STRIPE_PAYOUT_STATUS.PAID],
		[STRIPE_PAYOUT_STATUS.CANCELED, STRIPE_PAYOUT_STATUS.FAILED],
		[STRIPE_PAYOUT_STATUS.PAID, STRIPE_PAYOUT_STATUS.CANCELED],
		[STRIPE_PAYOUT_STATUS.FAILED, STRIPE_PAYOUT_STATUS.CANCELED],
	])(
		"keeps %s and flags a conflict when %s arrives — nothing moves into or out of canceled",
		(stored, incoming) => {
			expect(decidePayoutUpdate({ status: stored }, { status: incoming })).toEqual({
				apply: false,
				status: stored,
				conflict: true,
			});
			expect(isPayoutReturn({ status: stored }, { status: incoming })).toBe(false);
		}
	);

	it("still applies pending/in_transit → canceled, the normal forward path", () => {
		expect(
			decidePayoutUpdate(
				{ status: STRIPE_PAYOUT_STATUS.IN_TRANSIT },
				{ status: STRIPE_PAYOUT_STATUS.CANCELED }
			)
		).toEqual({ apply: true, status: STRIPE_PAYOUT_STATUS.CANCELED, conflict: false });
	});
});

describe("computeHeldTotal", () => {
	const failed = (id: string, amount: number, createdAt: number): HeldTotalInput => ({
		stripePayoutId: id,
		amount,
		createdAt,
		status: STRIPE_PAYOUT_STATUS.FAILED,
	});
	const paid = (id: string, amount: number, createdAt: number): HeldTotalInput => ({
		stripePayoutId: id,
		amount,
		createdAt,
		status: STRIPE_PAYOUT_STATUS.PAID,
	});

	it("is zero when nothing failed", () => {
		expect(computeHeldTotal([paid("po_1", 1000, 10)])).toEqual({
			heldCents: 0,
			unresolvedPayoutIds: [],
		});
	});

	it("holds a failed payout that nothing has replaced", () => {
		expect(computeHeldTotal([failed("po_1", 1000, 10)])).toEqual({
			heldCents: 1000,
			unresolvedPayoutIds: ["po_1"],
		});
	});

	it("counts only the NEWEST failure — a later sweep already carried the older one", () => {
		// The money that bounced on Monday is in Tuesday's sweep, because an
		// automatic payout takes the whole available balance. 1,000 stuck plus
		// 200 of new sales fails as 1,200; 2,200 was never stuck.
		expect(computeHeldTotal([failed("po_1", 1000, 10), failed("po_2", 1200, 20)])).toEqual({
			heldCents: 1200,
			unresolvedPayoutIds: ["po_2"],
		});
	});

	it("counts the newest failure even when it is SMALLER than the one it superseded", () => {
		// A refund or a lost dispute between the two shrank the balance. What is
		// stuck is what the last attempt carried.
		expect(computeHeldTotal([failed("po_1", 1000, 10), failed("po_2", 400, 20)]).heldCents).toBe(
			400
		);
	});

	it("holds two failures created at the very same instant — a split balance", () => {
		// Neither is "later" than the other, so neither re-swept the other's
		// money: both amounts really are stuck.
		expect(computeHeldTotal([failed("po_1", 1000, 10), failed("po_2", 250, 10)]).heldCents).toBe(
			1250
		);
	});

	it("resolves a failure once a LATER payout is paid, whatever its size", () => {
		expect(computeHeldTotal([failed("po_1", 1000, 10), paid("po_2", 1000, 20)])).toEqual({
			heldCents: 0,
			unresolvedPayoutIds: [],
		});
		expect(computeHeldTotal([failed("po_1", 1000, 10), paid("po_2", 4000, 20)]).heldCents).toBe(0);
	});

	it("resolves on a SMALLER later paid payout too — the balance shrank, it did not stick", () => {
		// Requiring "at least as large" would hold this money on the page forever
		// and suppress the payouts_resumed notification, when in fact the money
		// left: a refund or a dispute reduced the balance in between, or Stripe
		// settled it across two smaller payouts.
		expect(computeHeldTotal([failed("po_1", 1000, 10), paid("po_2", 300, 20)])).toEqual({
			heldCents: 0,
			unresolvedPayoutIds: [],
		});
	});

	it("does NOT resolve on an EARLIER paid payout", () => {
		expect(computeHeldTotal([paid("po_0", 5000, 5), failed("po_1", 1000, 10)]).heldCents).toBe(
			1000
		);
	});

	it("lets one later paid payout clear several older failures", () => {
		expect(
			computeHeldTotal([failed("po_1", 1000, 10), failed("po_2", 250, 20), paid("po_3", 40, 30)])
				.heldCents
		).toBe(0);
	});

	it("ignores pending and in-transit payouts, and lets a cancelled one supersede nothing", () => {
		const rows: HeldTotalInput[] = [
			failed("po_1", 1000, 10),
			{ stripePayoutId: "po_2", amount: 9999, createdAt: 20, status: STRIPE_PAYOUT_STATUS.PENDING },
			{
				stripePayoutId: "po_3",
				amount: 9999,
				createdAt: 30,
				status: STRIPE_PAYOUT_STATUS.IN_TRANSIT,
			},
			{
				// Cancelled before it left, so it never attempted the bank and the
				// stuck money is exactly where it was.
				stripePayoutId: "po_4",
				amount: 9999,
				createdAt: 40,
				status: STRIPE_PAYOUT_STATUS.CANCELED,
			},
		];
		expect(computeHeldTotal(rows)).toEqual({ heldCents: 1000, unresolvedPayoutIds: ["po_1"] });
	});

	it("does not care what order the rows arrive in", () => {
		const rows = [paid("po_2", 1000, 20), failed("po_1", 1000, 10)];
		expect(computeHeldTotal(rows).heldCents).toBe(0);
	});

	describe("a payout returned after it showed paid (paid → failed)", () => {
		const returned = (
			id: string,
			amount: number,
			createdAt: number,
			returnedAt: number
		): HeldTotalInput => ({ ...failed(id, amount, createdAt), returnedAt });

		it("is held even though routine payouts were created between it and the return", () => {
			// Monday's payout (10) shows paid; Tuesday's (20) and Wednesday's (30)
			// sweep new sales; Thursday (40) the bank returns Monday's. Neither
			// later payout carried Monday's money — it was not in the balance yet.
			expect(
				computeHeldTotal([
					returned("po_mon", 1000, 10, 40),
					paid("po_tue", 300, 20),
					paid("po_wed", 200, 30),
				])
			).toEqual({ heldCents: 1000, unresolvedPayoutIds: ["po_mon"] });
		});

		it("is resolved by a paid payout created after the return, just like a first-time failure", () => {
			expect(
				computeHeldTotal([returned("po_mon", 1000, 10, 40), paid("po_fri", 1500, 50)])
			).toEqual({ heldCents: 0, unresolvedPayoutIds: [] });
		});

		it("still supersedes an ordinary failure that is older than it", () => {
			// Monday's payout swept a balance that already held Sunday's bounce, so
			// when Monday's comes back it is carrying that money too.
			expect(
				computeHeldTotal([failed("po_sun", 400, 5), returned("po_mon", 1000, 10, 40)])
			).toEqual({ heldCents: 1000, unresolvedPayoutIds: ["po_mon"] });
		});

		it("is not superseded by a failure created before the return, and neither is that failure", () => {
			// Tuesday's payout (20) fails outright; Monday's is returned later (40).
			// Tuesday's sweep never contained Monday's money, so both are stuck.
			expect(
				computeHeldTotal([returned("po_mon", 1000, 10, 40), failed("po_tue", 300, 20)])
			).toEqual({
				heldCents: 1300,
				unresolvedPayoutIds: ["po_tue", "po_mon"],
			});
		});
	});
});

describe("heldTotalPaidLowerBound", () => {
	const failed = (id: string, createdAt: number, returnedAt?: number): HeldTotalInput => ({
		stripePayoutId: id,
		amount: 100,
		createdAt,
		status: STRIPE_PAYOUT_STATUS.FAILED,
		...(returnedAt !== undefined && { returnedAt }),
	});

	it("is null with no failures", () => {
		expect(heldTotalPaidLowerBound([])).toBeNull();
	});

	it("is the newest failure's createdAt for ordinary failures", () => {
		expect(heldTotalPaidLowerBound([failed("a", 10), failed("b", 20)])).toBe(20);
	});

	it("is the return time of a returned payout nothing has superseded", () => {
		expect(heldTotalPaidLowerBound([failed("a", 5), failed("b", 10, 40)])).toBe(40);
	});

	it("is the earliest standing threshold when a return left an older-created failure standing", () => {
		expect(heldTotalPaidLowerBound([failed("mon", 10, 40), failed("tue", 20)])).toBe(20);
	});
});

describe("formatPayoutAmount", () => {
	it("groups and always shows two decimals", () => {
		expect(formatPayoutAmount(123456)).toBe("1,234.56");
		expect(formatPayoutAmount(0)).toBe("0.00");
	});
});
