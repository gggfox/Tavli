import { expect, test } from "@playwright/test";

test.describe("Home page", () => {
	test("loads and displays the page title", async ({ page }) => {
		await page.goto("/");
		await expect(page).toHaveTitle("Tavli");
	});

	test("displays the welcome heading", async ({ page }) => {
		await page.goto("/");
		await expect(page.getByRole("heading", { level: 1 })).toContainText("Welcome to Tavli");
	});

	test("renders sign-in and get-started buttons", async ({ page }) => {
		await page.goto("/");
		await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
		await expect(page.getByRole("button", { name: /get started/i })).toBeVisible();
	});

	test("renders feature cards", async ({ page }) => {
		await page.goto("/");
		await expect(page.getByText("Menu Builder")).toBeVisible();
		await expect(page.getByText("Table Ordering")).toBeVisible();
		await expect(page.getByText("Secure Auth")).toBeVisible();
	});
});
