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
 * Every navigation requires the app's own `<title>` and an expected status (OK
 * via `gotoSettled`, or the diner not-found page's 404) — without that, these
 * assertions would also pass against an SSR 500 page, which is the failure
 * mode this suite is most likely to hit (a bad `CLERK_SECRET_KEY` turns every
 * page into a JSON error body).
 */
import { expect, test } from "@playwright/test";
import {
	STAFF_GUARD_HEADING,
	APP_TITLE,
	collectPageErrors,
	DINER_RESTAURANT_NOT_FOUND_HEADING,
	DINER_SIGN_IN_HEADING,
	ERROR_BOUNDARY_HEADING,
	fixtures,
	gotoSettled,
	hasFixtures,
	missingFixture,
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
 * Staff routes the pivot touched. `/admin/tabs` (the legacy settlement tail)
 * was deleted deliberately in the ADR 008 cleanup — no production pre-pivot
 * sessions ever existed — so it is intentionally absent here.
 */
const STAFF_ROUTES = [
	"/admin/orders",
	// `/admin/payments` is covered by stripe-admin-payments.spec.ts.
	"/admin/reservations",
	"/admin/restaurants",
	// Phase 4 replaced the settings modal with `?settings=<id>`; a malformed id
	// must not break `validateSearch`.
	"/admin/restaurants?settings=not-a-real-id",
	// Documented precedence: settings wins and clears manage.
	"/admin/restaurants?manage=a&settings=b",
] as const;

/**
 * Scope note: `SLUG` names no restaurant, so `/r/$slug`'s loader answers with
 * the diner not-found page (and a 404) instead of the `Outlet`. These tests
 * exercise **`validateSearch` and the not-found path**, not the page bodies —
 * a pivot-era search-param validator that throws still fails in the router,
 * before the loader, as an error page rather than this one.
 */
test.describe("ADR 008 diner surfaces", () => {
	for (const route of DINER_ROUTES) {
		test(`${route} renders the diner not-found page for an unknown restaurant`, async ({
			page,
		}) => {
			const errors = collectPageErrors(page);
			const response = await page.goto(route);
			await page.waitForLoadState("domcontentloaded");

			// A 404 from the app, not a 500 from a misconfigured server: the
			// app's own title is the proof, as in `gotoSettled`.
			expect(response?.status(), `${route} should be a 404`).toBe(404);
			await expect(page).toHaveTitle(APP_TITLE);
			await expect(
				page.getByRole("heading", { name: DINER_RESTAURANT_NOT_FOUND_HEADING })
			).toBeVisible();
			// An account would not make this restaurant exist.
			await expect(page.getByRole("heading", { name: DINER_SIGN_IN_HEADING })).toHaveCount(0);
			await expect(page.getByText(NOT_FOUND_HEADING)).toHaveCount(0);
			await expect(page.getByText(ERROR_BOUNDARY_HEADING)).toHaveCount(0);
			expect(errors).toEqual([]);
		});
	}
});

/**
 * Signed out against a real restaurant: the menu renders for anyone, and only
 * the pages about the diner's own orders ask them to sign in.
 */
test.describe("signed-out diner", () => {
	test.skip(!hasFixtures("restaurantSlug"), missingFixture("restaurantSlug"));

	test("can read the menu without signing in", async ({ page }) => {
		const errors = collectPageErrors(page);
		const response = await page.goto(`/r/${fixtures.restaurantSlug}/en/menu`);
		await page.waitForLoadState("domcontentloaded");

		expect(response?.status()).toBeLessThan(400);
		await expect(page.getByRole("heading", { name: DINER_SIGN_IN_HEADING })).toHaveCount(0);
		await expect(page.getByText(DINER_RESTAURANT_NOT_FOUND_HEADING)).toHaveCount(0);
		await expect(page.getByText(ERROR_BOUNDARY_HEADING)).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test("is asked to sign in on their orders", async ({ page }) => {
		const response = await page.goto(`/r/${fixtures.restaurantSlug}/en/orders`);
		await page.waitForLoadState("domcontentloaded");

		expect(response?.status()).toBeLessThan(400);
		await expect(page.getByRole("heading", { name: DINER_SIGN_IN_HEADING })).toBeVisible();
	});
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
			await expect(page.getByText(STAFF_GUARD_HEADING)).toBeVisible();
			expect(errors).toEqual([]);
		});
	}
});
