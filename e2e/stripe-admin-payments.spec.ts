/**
 * Stripe-adjacent smoke coverage.
 *
 * Scope boundary, stated so nobody assumes more than is here: this suite has
 * **no Stripe test-mode path**. It runs signed out against a Convex deployment
 * it does not seed, so there is no connected account, no PaymentIntent and no
 * card form to drive. ADR 008's card checkout therefore has no e2e happy path;
 * its arithmetic and state machine are covered by the Convex and component
 * tests, and the diner-visible fee breakdown is covered (fixture-gated) in
 * `settlement-flows.spec.ts`.
 *
 * What this file does assert is that the payments dashboard route survived the
 * settlement pivot and is still gated to staff.
 */
import { expect, test } from "@playwright/test";
import {
	ACCESS_DENIED_HEADING,
	collectPageErrors,
	ERROR_BOUNDARY_HEADING,
	gotoSettled,
} from "./support/harness";

test.describe("Stripe admin smoke", () => {
	test("the payments admin route loads and stays gated to staff", async ({ page }) => {
		const errors = collectPageErrors(page);
		await gotoSettled(page, "/admin/payments");

		// Previously this asserted only that <body> was non-empty, which also
		// holds for an SSR 500 error page. `gotoSettled` now requires an OK
		// status and the app's own title, and the guard copy is a positive
		// signal that the route actually rendered.
		await expect(page.getByText(ACCESS_DENIED_HEADING)).toBeVisible();
		await expect(page.getByText(ERROR_BOUNDARY_HEADING)).toHaveCount(0);
		expect(errors).toEqual([]);
	});
});
