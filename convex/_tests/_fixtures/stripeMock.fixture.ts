/**
 * The one Stripe mock every Convex test suite shares.
 *
 * `convex/_util/stripe.ts` builds its client with `new Stripe(key, ...)`, so a
 * suite that exercises anything payment-shaped has to replace the `stripe`
 * module. That replacement used to be hand-copied into each suite, which meant
 * five slightly different surfaces: one had `refunds.list`, another had
 * `checkout.sessions`, a third had neither, and adding a Stripe call to a
 * helper broke whichever copies had not been updated. This module is the union
 * of those surfaces plus the read-only payout/refund listing calls the
 * reconciliation work needs.
 *
 * Usage in a suite (the two lines belong together):
 *
 * ```ts
 * import { mockStripeClient } from "./_fixtures/stripeMock.fixture";
 *
 * vi.mock("stripe", async () => (await import("./_fixtures/stripeMock.fixture")).stripeModuleMock());
 * ```
 *
 * `vi.mock` is hoisted above the imports, so its factory cannot close over a
 * binding declared in the test file — hence the dynamic `import()` inside the
 * factory, which vitest resolves lazily and which returns the very same module
 * instance the static import above binds. Per-test overrides therefore work
 * unchanged: `mockStripeClient.paymentIntents.create.mockResolvedValueOnce(...)`.
 *
 * Each vitest file gets its own module registry, so the shared functions are
 * not shared *between* suites — no cross-file bleed. Within a suite the usual
 * `vi.clearAllMocks()` in `beforeEach` still resets them.
 *
 * The `.fixture.ts` suffix is load-bearing, not decoration. A leading `_` on a
 * directory does NOT keep Convex out: `convex/_tests/helpers/reservationsFlag.ts`
 * is bundled and pushed like any other module. What Convex's bundler skips is a
 * file whose basename holds more than one dot -- which is exactly why
 * `*.test.ts` files are never pushed. Named `stripeMock.ts`, this file was
 * bundled, and `npx convex codegen` failed analysing it with "Vitest failed to
 * access its internal state", because importing `vitest` outside the vitest
 * runtime throws. The second dot puts it on the same footing as the suites
 * that import it. Vitest, for its part, only collects `*.test.ts`, so it does
 * not try to run this file as an empty suite.
 */
import { vi } from "vitest";

/**
 * The mocked Stripe client. Every call is a bare `vi.fn()` with no default
 * implementation: a suite that reaches an unstubbed call gets `undefined`
 * back and fails loudly rather than silently passing on a fixture nobody set.
 */
export const mockStripeClient = {
	v2: {
		core: {
			accounts: {
				create: vi.fn(),
				retrieve: vi.fn(),
				/** `resetStripeConnection` closes the connected account before unlinking. */
				close: vi.fn(),
			},
			accountLinks: {
				create: vi.fn(),
			},
			events: {
				retrieve: vi.fn(),
			},
		},
	},
	paymentIntents: {
		create: vi.fn(),
		retrieve: vi.fn(),
		cancel: vi.fn(),
	},
	customers: {
		create: vi.fn(),
	},
	refunds: {
		create: vi.fn(),
		/**
		 * Used to re-read a refund the webhook only summarised. Since TAVLI-102
		 * this runs on EVERY `charge.refunded`, because the fetched refund is
		 * the only place `transfer_reversal` exists — the field that tells a
		 * refund Tavli issued from one typed into the Stripe Dashboard.
		 */
		list: vi.fn(),
	},
	/**
	 * Returning what a reinstated dispute had already recovered (TAVLI-102).
	 * The original charges are long settled, so a transfer to the connected
	 * account is the only way to move the money back.
	 */
	transfers: {
		create: vi.fn(),
		/**
		 * Taking part of a standalone transfer back when the sale behind it is
		 * refunded. A refund reverses the CHARGE's transfer and nothing else, so
		 * the returns this ticket makes have to be reversed explicitly.
		 */
		createReversal: vi.fn(),
	},
	/**
	 * Read when a `charge.dispute.*` delivery arrives without
	 * `balance_transactions`, to learn Stripe's dispute fee — the cost Tavli
	 * absorbs and aggregates per month.
	 */
	disputes: {
		retrieve: vi.fn(),
	},
	/**
	 * Payout reads for reconciliation. No suite stubs these yet; they exist so
	 * the first suite that needs them does not have to widen the fixture.
	 */
	payouts: {
		retrieve: vi.fn(),
		list: vi.fn(),
	},
	checkout: {
		sessions: {
			create: vi.fn(),
		},
	},
	billingPortal: {
		sessions: {
			create: vi.fn(),
		},
	},
	subscriptions: {
		update: vi.fn(),
		cancel: vi.fn(),
	},
	webhooks: {
		constructEvent: vi.fn(),
	},
	/** V2 thin events arrive through this, not `webhooks.constructEvent`. */
	parseEventNotification: vi.fn(),
};

/**
 * Stands in for the `Stripe` class. Asserting on it proves a client was
 * constructed (and with which key/options) without reaching Stripe.
 */
export const StripeConstructor = vi.fn(() => mockStripeClient);

/**
 * The module shape `vi.mock("stripe", ...)` must return. Kept as a function so
 * the mock factory can call it after its dynamic import.
 */
export function stripeModuleMock() {
	return { default: StripeConstructor };
}
