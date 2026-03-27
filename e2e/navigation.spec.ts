import { expect, test } from "@playwright/test";

test.describe("Navigation", () => {
	test("sidebar is visible on the home page", async ({ page }) => {
		await page.goto("/");
		const sidebar = page.locator("nav, aside").first();
		await expect(sidebar).toBeVisible();
	});

	test("admin route loads without crashing", async ({ page }) => {
		await page.goto("/admin");
		await page.waitForLoadState("domcontentloaded");
		await expect(page.locator("body")).not.toBeEmpty();
	});

	test("navigating to a non-existent route does not produce a blank page", async ({ page }) => {
		await page.goto("/this-does-not-exist");
		await page.waitForLoadState("domcontentloaded");
		await expect(page.locator("body")).not.toBeEmpty();
	});
});
