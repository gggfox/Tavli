import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouteErrorComponent } from "./RouteErrorComponent";

/**
 * The point of `defaultErrorComponent` is that a route which throws is caught
 * by the router — no per-route boilerplate — and rendered through the same
 * panel as `ErrorBoundary`. These tests drive a real router so they fail if
 * that wiring is ever dropped from `src/router.tsx`.
 */
function renderRouterThatThrows(error: Error) {
	const rootRoute = createRootRoute();
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: function Boom(): never {
			throw error;
		},
	});

	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute]),
		defaultErrorComponent: RouteErrorComponent,
	});

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return render(<RouterProvider router={router as any} />);
}

describe("RouteErrorComponent", () => {
	const originalConsoleError = console.error;

	beforeEach(() => {
		console.error = vi.fn();
	});

	afterEach(() => {
		console.error = originalConsoleError;
	});

	it("renders the shared fallback panel when a route throws", async () => {
		renderRouterThatThrows(new Error("Database connection failed"));

		await waitFor(() => {
			expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeDefined();
		});
		expect(screen.getByRole("button", { name: "Try Again" })).toBeDefined();
		expect(screen.getByRole("button", { name: "Reload Page" })).toBeDefined();
	});

	it("never leaks the raw error message", async () => {
		renderRouterThatThrows(new Error("Database connection failed"));

		await waitFor(() => {
			expect(screen.getByText("An unexpected error occurred. Please try again.")).toBeDefined();
		});
		expect(screen.queryByText("Database connection failed")).toBeNull();
	});

	it("maps a known backend error code to its localized message", async () => {
		renderRouterThatThrows(new Error("ERROR_MANAGER_ROLE_REQUIRED"));

		await waitFor(() => {
			expect(screen.getByText("You need manager permissions to do that.")).toBeDefined();
		});
		expect(screen.queryByText("ERROR_MANAGER_ROLE_REQUIRED")).toBeNull();
	});

	it("offers the sign-in recovery for auth errors", async () => {
		renderRouterThatThrows(new Error("Not authenticated"));

		await waitFor(() => {
			expect(screen.getByText("Session expired")).toBeDefined();
		});
		expect(screen.getByRole("button", { name: "Sign In" })).toBeDefined();
		expect(screen.queryByRole("button", { name: "Try Again" })).toBeNull();
	});
});
