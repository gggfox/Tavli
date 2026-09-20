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
 * import { mockStripeClient } from "./_fixtures/stripeMock";
 *
 * vi.mock("stripe", async () => (await import("./_fixtures/stripeMock")).stripeModuleMock());
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
 * This file lives under `convex/_tests/_fixtures/` on purpose. It is picked up
 * by `import.meta.glob("../**\/*.ts")` like every other file under `convex/`,
 * but it defines no Convex function, and Convex never registers a path segment
 * starting with `_` as a function module. Its name does not match vitest's
 * `*.test.ts` include either, so it is not collected as a suite.
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
		/** Used to re-read a refund set the webhook only summarised. */
		list: vi.fn(),
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
