/**
 * ADR 008 critical paths that need real data.
 *
 * **These specs skip unless the `E2E_*` fixture variables are set** (see
 * `e2e/support/harness.ts`). Nothing in this repo seeds a Convex deployment
 * and the CI e2e job runs signed out, so there is no honest way to make them
 * self-provisioning without inventing a seeding harness this suite does not
 * have. Skipped-with-a-reason beats a test that passes because the page was
 * empty.
 *
 * The file runs serially: the diner's "pay in person" test produces the
 * `awaiting_payment` order that the staff tests then collect and release.
 *
 * ⚠️ These tests mutate real data — they take a draft order out of `draft`
 * and change the staff user's persisted dashboard filter. Point them at a
 * scratch restaurant, and expect to mint a fresh `E2E_DRAFT_ORDER_ID` per run.
 *
 * No card-payment path is covered here. `stripe-admin-payments.spec.ts` is a
 * route smoke test, not a proven Stripe test-mode flow, so there is no
 * existing plumbing to extend and this file stops at the "Pay in person"
 * boundary by design.
 */
import { expect, test, type Page } from "@playwright/test";
import { PLATFORM_APPLICATION_FEE_RATE } from "convex/constants";
import {
	collectPageErrors,
	fixtures,
	gotoSettled,
	hasFixtures,
	missingFixture,
	parseMoneyToCents,
	restoreDinerSession,
} from "./support/harness";

test.describe.configure({ mode: "serial" });

/** Service-fee rate as the display percentage the checkout line carries. */
const FEE_PERCENT = PLATFORM_APPLICATION_FEE_RATE * 100;

/**
 * Daily order number of the order the diner committed to cash, handed to the
 * staff specs below. `null` until the diner spec has run.
 */
let cashOrderNumber: string | null = null;

/**
 * Read one money row out of the checkout summary. The summary has no test ids
 * and this spec may not add them (the component is out of scope), so rows are
 * located by their label text inside the shared `flex justify-between` row.
 */
async function summaryCents(page: Page, label: RegExp): Promise<number> {
	const row = page.locator("div.flex.justify-between").filter({ has: page.getByText(label) });
	const value = await row.first().locator("span").last().innerText();
	return parseMoneyToCents(value);
}

test.describe("Diner per-order checkout (ADR 008)", () => {
	const NEEDED = [
		"dinerStorageState",
		"restaurantId",
		"restaurantSlug",
		"dinerSessionId",
		"draftOrderId",
	] as const;
	test.skip(!hasFixtures(...NEEDED), missingFixture(...NEEDED));
	test.use({ storageState: fixtures.dinerStorageState });

	const checkoutUrl = () =>
		`/r/${fixtures.restaurantSlug}/en/checkout?orderId=${fixtures.draftOrderId}`;

	test("shows subtotal + Tavli service fee + total, and the arithmetic adds up", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await restoreDinerSession(page);
		await gotoSettled(page, checkoutUrl());

		await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
		// The fee line is the headline product change: it must name the rate the
		// diner is being charged, not just a bare amount.
		await expect(page.getByText(`Tavli service fee (${FEE_PERCENT}%)`)).toBeVisible();

		const subtotal = await summaryCents(page, /^Subtotal$/);
		const fee = await summaryCents(page, /^Tavli service fee/);
		const total = await summaryCents(page, /^Total$/);

		expect(subtotal).toBeGreaterThan(0);
		// Customer-borne, on top — not carved out of the subtotal.
		expect(fee).toBe(Math.round(subtotal * PLATFORM_APPLICATION_FEE_RATE));
		expect(total).toBe(subtotal + fee);
		expect(errors).toEqual([]);
	});

	test("'Pay in person' commits the order for cash instead of charging a card", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await restoreDinerSession(page);
		await gotoSettled(page, checkoutUrl());

		await page.getByRole("button", { name: "Pay in person" }).click();

		// awaiting_payment: the diner is told to pay at the table and warned the
		// kitchen has not started.
		await expect(page.getByRole("heading", { name: "Pay at the table" })).toBeVisible();
		await expect(
			page.getByText("Your order will go to the kitchen once the staff confirms your payment.")
		).toBeVisible();

		const orderLabel = await page.getByText(/^Order #\d+$/).innerText();
		cashOrderNumber = orderLabel.replace(/\D/g, "");
		expect(cashOrderNumber).not.toBe("");
		expect(errors).toEqual([]);
	});
});

test.describe("Staff orders dashboard (ADR 008)", () => {
	test.skip(!hasFixtures("staffStorageState"), missingFixture("staffStorageState"));
	test.use({ storageState: fixtures.staffStorageState });

	/** The dashboard's single-select status control. */
	const segments = (page: Page) =>
		page.getByRole("radiogroup", { name: "Show orders with status" });

	const SEGMENT_LABELS = [
		"Awaiting payment",
		"Pending",
		"Preparing",
		"Ready",
		"Served",
		"Cancelled",
	] as const;

	test("the status segmented control selects exactly one state and survives a reload", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoSettled(page, "/admin/orders");

		await segments(page).getByRole("radio", { name: "Ready", exact: true }).click();

		// Single-select, not a union: every other segment must go unchecked.
		for (const label of SEGMENT_LABELS) {
			await expect(segments(page).getByRole("radio", { name: label, exact: true })).toHaveAttribute(
				"aria-checked",
				label === "Ready" ? "true" : "false"
			);
		}

		// Persisted server-side in `userSettings.orderDashboardStatusFilter`, so
		// it must come back after a full reload, not just a client re-render.
		await page.reload();
		await page.waitForLoadState("domcontentloaded");
		await expect(segments(page).getByRole("radio", { name: "Ready", exact: true })).toHaveAttribute(
			"aria-checked",
			"true"
		);
		expect(errors).toEqual([]);
	});

	test("an awaiting-payment order shows only in its own segment, then staff release it", async ({
		page,
	}) => {
		test.skip(
			cashOrderNumber === null,
			"needs the diner 'Pay in person' spec to have produced an awaiting_payment order"
		);
		const cardNumber = `#${cashOrderNumber}`;

		await gotoSettled(page, "/admin/orders");

		// 1. It is in Awaiting payment.
		await segments(page).getByRole("radio", { name: "Awaiting payment", exact: true }).click();
		await expect(page.getByText(cardNumber, { exact: true }).first()).toBeVisible();

		// 2. It is NOT in the kitchen queue — unpaid food never fires (ADR 008).
		await segments(page).getByRole("radio", { name: "Pending", exact: true }).click();
		await expect(page.getByText(cardNumber, { exact: true })).toHaveCount(0);
		await segments(page).getByRole("radio", { name: "Preparing", exact: true }).click();
		await expect(page.getByText(cardNumber, { exact: true })).toHaveCount(0);

		// 3. Staff collect cash and release it.
		await segments(page).getByRole("radio", { name: "Awaiting payment", exact: true }).click();
		await page.getByRole("button", { name: "Mark paid in person" }).first().click();
		await expect(page.getByText("Mark this order as paid?")).toBeVisible();
		await page.getByRole("button", { name: "Confirm payment" }).click();

		// 4. It leaves Awaiting payment and lands in the kitchen queue.
		await expect(page.getByText(cardNumber, { exact: true })).toHaveCount(0);
		await segments(page).getByRole("radio", { name: "Pending", exact: true }).click();
		await expect(page.getByText(cardNumber, { exact: true }).first()).toBeVisible();
	});
});

test.describe("Restaurant settings canvas (ADR 008 phase 4)", () => {
	test.skip(
		!hasFixtures("staffStorageState", "restaurantId"),
		missingFixture("staffStorageState", "restaurantId")
	);
	test.use({ storageState: fixtures.staffStorageState });

	test("?settings=<id> opens the full canvas and back returns to the list", async ({ page }) => {
		const errors = collectPageErrors(page);
		await gotoSettled(page, `/admin/restaurants?settings=${fixtures.restaurantId}`);

		// The canvas, not the old modal: sections render inline and the
		// list-page action row is gone.
		await expect(page.getByTestId("settings-section-payments")).toBeVisible();
		await expect(page.getByTestId("restaurant-canvas-not-found")).toHaveCount(0);

		await page.getByRole("button", { name: "Close restaurant settings" }).click();

		await expect(page).toHaveURL(/\/admin\/restaurants$/);
		await expect(page.getByTestId("settings-section-payments")).toHaveCount(0);
		expect(errors).toEqual([]);
	});
});

test.describe("Completed reservations (ADR 008 phase 4)", () => {
	test.skip(!hasFixtures("staffStorageState"), missingFixture("staffStorageState"));
	test.use({ storageState: fixtures.staffStorageState });

	test("a completed reservation keeps editable times and confirms before cancelling", async ({
		page,
	}) => {
		await gotoSettled(page, "/admin/reservations");

		// Force the table view: its rows are the one reservation surface with a
		// single unambiguous click target (`<tr onClick>` → open drawer).
		await page
			.getByRole("radiogroup", { name: "Switch between card list and table view" })
			.getByRole("radio", { name: "Table", exact: true })
			.click();

		const completedRow = page.getByRole("row").filter({ hasText: "Completed" });
		test.skip(
			(await completedRow.count()) === 0,
			"needs a reservation in `completed` status in the dashboard's current range"
		);
		await completedRow.first().click();

		const drawer = page.getByRole("dialog", { name: "Reservation details" });
		await expect(drawer).toBeVisible();

		// Times stay correctable on a completed visit; tables are locked.
		await expect(
			drawer.getByText("This visit already happened — you can correct its times.", { exact: false })
		).toBeVisible();
		await expect(drawer.getByLabel("Start")).toBeEditable();
		await expect(drawer.getByLabel("End")).toBeEditable();
		await expect(drawer.getByText("Tables (locked)")).toBeVisible();

		// Cancelling a completed reservation is a correction, so it is gated by
		// an explicit confirmation rather than firing on the first click.
		await drawer.getByRole("button", { name: "Cancel", exact: true }).click();
		await expect(page.getByText("Cancel a completed reservation?")).toBeVisible();
		await expect(page.getByRole("button", { name: "Confirm cancel" })).toBeVisible();

		// Back out — this spec asserts the gate exists, it does not destroy the
		// fixture.
		await page.getByRole("button", { name: "Back", exact: true }).click();
		await expect(page.getByText("Cancel a completed reservation?")).toHaveCount(0);
	});
});
