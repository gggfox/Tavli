/**
 * Shared helpers for the Playwright suite.
 *
 * ## What this harness can and cannot do
 *
 * The e2e job runs the app against a Convex deployment it never seeds, with
 * **no signed-in Clerk session** (see `.github/workflows/ci.yml` →
 * `e2e-tests`: a publishable test key, a placeholder secret key, no storage
 * state, no fixtures). There is no seed script anywhere in the repo.
 *
 * That makes two classes of assertion available for free, and one class
 * available only to whoever supplies a signed-in session plus fixture ids:
 *
 * - **Free — routing and guards.** A route either resolves or falls through to
 *   `RootNotFound`; `/admin/*` either renders the staff shell or the
 *   not-staff guard. Both are deterministic signed out, and both regress
 *   loudly when a pivot moves or deletes a surface.
 * - **Free — no uncaught errors.** {@link collectPageErrors} catches anything
 *   that escapes React and the router error boundary.
 * - **Gated — data flows.** Anything that needs an order, a restaurant, a
 *   reservation or a staff role is gated on the `E2E_*` variables below and
 *   skips with a reason rather than passing vacuously.
 */
import { expect, type Page } from "@playwright/test";

/**
 * Copy rendered by `RootNotFound` (`src/routes/__root.tsx`) when the router
 * matches nothing. Asserting its *absence* is how these specs prove a route is
 * registered without a backend or a session.
 */
export const NOT_FOUND_HEADING = "Page not found";

/**
 * Copy rendered by the `/admin` layout for a visitor who is not signed in as
 * staff (`src/routes/admin.tsx`). Signed out — which is how CI runs — every
 * `/admin/*` route legitimately stops here, so this string doubles as "the
 * route exists and its guard held".
 */
export const ACCESS_DENIED_HEADING = "Access Denied";

/**
 * Copy rendered by `ErrorFallback` behind `RouteErrorComponent`. A route that
 * throws during render does not produce a `pageerror` — the router catches it
 * — so specs assert this string is absent as well.
 */
export const ERROR_BOUNDARY_HEADING = "Something went wrong";

/** `<title>` the root route sets. Absent on an SSR error page. */
export const APP_TITLE = "Tavli";

/**
 * Copy rendered by the `/r/$slug` customer layout for a signed-out visitor
 * (`ordering.session.signInRequired`). The layout short-circuits before its
 * `Outlet`, so signed out this is what every diner route renders — which makes
 * it the positive "the router matched and the customer shell mounted" signal.
 */
export const DINER_SIGN_IN_HEADING = "Sign in to order";

/**
 * Start collecting uncaught page errors. Call before the first navigation and
 * assert the returned array is empty at the end of the test.
 *
 * Note the blind spot: TanStack Router renders `RouteErrorComponent` for
 * errors thrown in a route component, so a thrown render error surfaces as
 * error-boundary copy rather than a `pageerror`. Specs that care assert on the
 * absence of that copy too.
 */
export function collectPageErrors(page: Page): readonly string[] {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	return errors;
}

/**
 * Navigate, wait for the document, and prove the **app** answered.
 *
 * The positive checks matter more than they look. When the server misconfigures
 * (for instance an invalid `CLERK_SECRET_KEY`, which makes every SSR request
 * return a `{"status":500,...}` JSON body), a page still has a non-empty
 * `<body>` and still contains no "Page not found" text — so an
 * absence-only assertion passes against a hard 500. Requiring an OK status and
 * the app's own `<title>` closes that hole.
 */
export async function gotoSettled(page: Page, url: string): Promise<void> {
	const response = await page.goto(url);
	await page.waitForLoadState("domcontentloaded");
	expect(response, `no response for ${url}`).not.toBeNull();
	expect(response?.status(), `${url} did not return an OK status`).toBeLessThan(400);
	await expect(page).toHaveTitle(APP_TITLE);
}

/**
 * Fixture contract for the data-dependent specs. Every one of these is unset
 * in CI today, so those specs skip with a reason.
 *
 * Note that the diner is **Clerk-authenticated too** — `requireOwnedOrder` in
 * `convex/_util/dinerSession.ts` resolves the caller's identity and checks tab
 * membership — so the diner flows need their own storage state, not just an
 * order id.
 *
 * To run them locally:
 *
 * ```bash
 * # 1. Sign in once as an owner/manager and once as a diner, saving each:
 * #    npx playwright open --save-storage=.auth/staff.json http://localhost:3000
 * #    npx playwright open --save-storage=.auth/diner.json http://localhost:3000
 * export E2E_STAFF_STORAGE_STATE=.auth/staff.json
 * export E2E_DINER_STORAGE_STATE=.auth/diner.json
 * export E2E_RESTAURANT_ID=<restaurants _id>
 * export E2E_RESTAURANT_SLUG=<restaurants slug>
 * # 2. As that diner, open a tab and build a round (scan → add items → cart).
 * #    The cart URL carries the draft order id; the session id is in
 * #    sessionStorage under "tavli_session":
 * export E2E_DINER_SESSION_ID=<sessions _id, status "active">
 * export E2E_DRAFT_ORDER_ID=<orders _id, status "draft">
 * pnpm test:e2e
 * ```
 */
export const fixtures = {
	/** Playwright `storageState` JSON for a signed-in owner/manager. */
	staffStorageState: process.env.E2E_STAFF_STORAGE_STATE,
	/** Playwright `storageState` JSON for the diner who owns the draft order. */
	dinerStorageState: process.env.E2E_DINER_STORAGE_STATE,
	/** `restaurants._id` the staff account can administer. */
	restaurantId: process.env.E2E_RESTAURANT_ID,
	/** `restaurants.slug` for the diner-facing `/r/:slug` routes. */
	restaurantSlug: process.env.E2E_RESTAURANT_SLUG,
	/** `sessions._id` (active) the diner belongs to and the draft order hangs off. */
	dinerSessionId: process.env.E2E_DINER_SESSION_ID,
	/** `orders._id` of an order still in `draft` on that restaurant. */
	draftOrderId: process.env.E2E_DRAFT_ORDER_ID,
} as const;

/** Reason string for a spec skipped because a fixture variable is unset. */
export function missingFixture(...names: ReadonlyArray<keyof typeof fixtures>): string {
	const envNames = names.map((name) => ENV_NAMES[name]).join(", ");
	return `needs a seeded backend: set ${envNames} (see e2e/support/harness.ts)`;
}

const ENV_NAMES: Record<keyof typeof fixtures, string> = {
	staffStorageState: "E2E_STAFF_STORAGE_STATE",
	dinerStorageState: "E2E_DINER_STORAGE_STATE",
	restaurantId: "E2E_RESTAURANT_ID",
	restaurantSlug: "E2E_RESTAURANT_SLUG",
	dinerSessionId: "E2E_DINER_SESSION_ID",
	draftOrderId: "E2E_DRAFT_ORDER_ID",
};

/**
 * Seed the diner's ordering session before the app boots.
 *
 * `useCustomerSession` restores from **sessionStorage** (`tavli_session`,
 * written by `useSession`), which Playwright's `storageState` does not capture
 * — cookies and localStorage only. Without this the signed-in diner would
 * bootstrap a brand-new session and `requireOwnedOrder` would reject the
 * fixture order as belonging to someone else's tab.
 */
export async function restoreDinerSession(page: Page): Promise<void> {
	const sessionId = fixtures.dinerSessionId;
	const restaurantId = fixtures.restaurantId;
	await page.addInitScript(
		([session, restaurant]) => {
			try {
				sessionStorage.setItem(
					"tavli_session",
					JSON.stringify({ sessionId: session, restaurantId: restaurant })
				);
			} catch {
				// sessionStorage unavailable — the spec's own assertions will fail.
			}
		},
		[sessionId, restaurantId] as const
	);
}

/** True when every named fixture variable is set to a non-empty value. */
export function hasFixtures(...names: ReadonlyArray<keyof typeof fixtures>): boolean {
	return names.every((name) => (fixtures[name] ?? "").length > 0);
}

/**
 * Parse a `$1,234.56` money cell into integer cents, so specs can assert the
 * ADR 008 fee arithmetic on what the diner actually sees rather than on a
 * formatted string.
 */
export function parseMoneyToCents(text: string): number {
	const digits = text.replace(/[^0-9.]/g, "");
	return Math.round(Number.parseFloat(digits) * 100);
}
