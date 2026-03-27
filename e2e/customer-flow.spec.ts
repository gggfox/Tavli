import { expect, test } from "@playwright/test";

test.describe("Customer ordering flow", () => {
	test("customer table page loads without error", async ({ page }) => {
		await page.goto("/r/test-restaurant/t/1");
		await page.waitForLoadState("domcontentloaded");
		// The page should load without a JavaScript error even if the
		// restaurant doesn't exist in the backend -- it should render
		// some form of UI rather than crash.
		await expect(page.locator("body")).not.toBeEmpty();
	});

	test("customer table page does not render the sidebar", async ({ page }) => {
		await page.goto("/r/test-restaurant/t/1");
		await page.waitForLoadState("domcontentloaded");
		// The root layout hides the sidebar for /r/* routes
		const sidebar = page.locator('[data-testid="sidebar"]');
		await expect(sidebar).toHaveCount(0);
	});
});
