/**
 * ADR 008 (customer-borne commission and pay-at-submit) moved the diner's
 * payment from an end-of-visit tab to a per-order checkout, added the
 * `awaiting_payment` staff surface, and turned restaurant settings from a
 * modal into a URL-addressable canvas.
 *
 * This file covers what the harness can prove without a session or seeded
 * data: every surface the pivot introduced or moved is **still routable**, its
 * guard behaves, and nothing throws. The behaviour of those surfaces lives in
 * `settlement-flows.spec.ts`, which is gated on fixtures.
 *
 * Every navigation goes through `gotoSettled`, which requires an OK status and
 * the app's own `<title>` — without that, these assertions would also pass
 * against an SSR 500 page, which is the failure mode this suite is most likely
 * to hit (a bad `CLERK_SECRET_KEY` turns every page into a JSON error body).
 */
import { expect, test } from "@playwright/test";
import {
	ACCESS_DENIED_HEADING,
	collectPageErrors,
	DINER_SIGN_IN_HEADING,
	ERROR_BOUNDARY_HEADING,
	gotoSettled,
	NOT_FOUND_HEADING,
} from "./support/harness";

/** Any slug works: these tests assert routing, not restaurant content. */
const SLUG = "e2e-nonexistent-restaurant";

/**
 * Diner-facing routes the pivot introduced or re-pointed. `checkout` gained an
 * `?orderId` search param (present → per-order checkout, absent → the legacy
 * tab checkout), and `closeout` is entirely new (per-member post-visit tips).
 */
const DINER_ROUTES = [
	`/r/${SLUG}/en/menu`,
	`/r/${SLUG}/en/orders`,
	`/r/${SLUG}/en/closeout`,
	`/r/${SLUG}/en/checkout`,
	// A submitted round lands here; a stale or foreign id must degrade to an
	// empty state, not a crash.
	`/r/${SLUG}/en/checkout?orderId=not-a-real-order-id`,
	`/r/${SLUG}/en/cart?orderId=not-a-real-order-id`,
] as const;

/**
 * Staff routes the pivot touched. `/admin/tabs` is the legacy settlement tail
 * ADR 008 keeps until T+30d — it must stay routable until it is deleted
 * deliberately, not by accident.
 */
const STAFF_ROUTES = [
	"/admin/orders",
	// `/admin/payments` is covered by stripe-admin-payments.spec.ts.
	"/admin/reservations",
	"/admin/restaurants",
	"/admin/tabs",
	// Phase 4 replaced the settings modal with `?settings=<id>`; a malformed id
	// must not break `validateSearch`.
	"/admin/restaurants?settings=not-a-real-id",
	// Documented precedence: settings wins and clears manage.
	"/admin/restaurants?manage=a&settings=b",
] as const;

/**
 * Scope note: signed out, `/r/$slug` renders its sign-in gate instead of the
 * `Outlet`, so these tests exercise **route matching and `validateSearch`**,
 * not the page bodies. That is still the coverage that matters here — a
 * pivot-era search-param validator that throws, or a route file that stopped
 * being registered, fails right there in the router before any component
 * mounts.
 */
test.describe("ADR 008 diner surfaces", () => {
	for (const route of DINER_ROUTES) {
		test(`${route} matches a route and mounts the customer shell`, async ({ page }) => {
			const errors = collectPageErrors(page);
			await gotoSettled(page, route);

			await expect(page.getByRole("heading", { name: DINER_SIGN_IN_HEADING })).toBeVisible();
			await expect(page.getByText(NOT_FOUND_HEADING)).toHaveCount(0);
			await expect(page.getByText(ERROR_BOUNDARY_HEADING)).toHaveCount(0);
			expect(errors).toEqual([]);
		});
	}
});

test.describe("ADR 008 staff surfaces", () => {
	for (const route of STAFF_ROUTES) {
		test(`${route} renders the staff guard for a signed-out visitor`, async ({ page }) => {
			const errors = collectPageErrors(page);
			await gotoSettled(page, route);

			// Three assertions in one: the route is registered (no RootNotFound),
			// it did not throw (no error boundary), and the /admin guard held
			// instead of leaking a dashboard to an anonymous visitor.
			await expect(page.getByText(NOT_FOUND_HEADING)).toHaveCount(0);
			await expect(page.getByText(ERROR_BOUNDARY_HEADING)).toHaveCount(0);
			await expect(page.getByText(ACCESS_DENIED_HEADING)).toBeVisible();
			expect(errors).toEqual([]);
		});
	}
});
