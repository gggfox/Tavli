import { expect, test } from "@playwright/test";

test.describe("Stripe admin smoke", () => {
	test("products admin route loads without crashing", async ({ page }) => {
		await page.goto("/admin/products");
		await page.waitForLoadState("domcontentloaded");
		await expect(page.locator("body")).not.toBeEmpty();
	});

	test("payments admin route loads without crashing", async ({ page }) => {
		await page.goto("/admin/payments");
		await page.waitForLoadState("domcontentloaded");
		await expect(page.locator("body")).not.toBeEmpty();
	});
});
