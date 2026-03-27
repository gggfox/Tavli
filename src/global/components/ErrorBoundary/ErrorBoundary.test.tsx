import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

// Component that throws an error
function ThrowingComponent({ error }: { error: Error }): never {
	throw error;
}

// Component that renders normally
function NormalComponent() {
	return <div data-testid="normal-content">Normal content</div>;
}

describe("ErrorBoundary", () => {
	// Suppress React error boundary console.error for cleaner test output
	const originalConsoleError = console.error;

	beforeEach(() => {
		console.error = vi.fn();
	});

	afterEach(() => {
		console.error = originalConsoleError;
	});

	describe("rendering", () => {
		it("renders children when there is no error", () => {
			render(
				<ErrorBoundary>
					<NormalComponent />
				</ErrorBoundary>
			);

			expect(screen.getByTestId("normal-content")).toBeDefined();
			expect(screen.getByText("Normal content")).toBeDefined();
		});

		it("renders custom fallback when provided and error occurs", () => {
			const fallback = <div data-testid="custom-fallback">Custom Error UI</div>;

			render(
				<ErrorBoundary fallback={fallback}>
					<ThrowingComponent error={new Error("Test error")} />
				</ErrorBoundary>
			);

			expect(screen.getByTestId("custom-fallback")).toBeDefined();
			expect(screen.getByText("Custom Error UI")).toBeDefined();
		});

		it("renders default error UI when error occurs without fallback", () => {
			render(
				<ErrorBoundary>
					<ThrowingComponent error={new Error("Database connection failed")} />
				</ErrorBoundary>
			);

			// The heading shows generic text, the paragraph shows the actual error message
			expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeDefined();
			expect(screen.getByText("Database connection failed")).toBeDefined();
			expect(screen.getByRole("button", { name: "Try Again" })).toBeDefined();
			expect(screen.getByRole("button", { name: "Reload Page" })).toBeDefined();
		});
	});

	describe("authentication errors", () => {
		it("detects authentication error and shows session expired message", () => {
			render(
				<ErrorBoundary>
					<ThrowingComponent error={new Error("Not authenticated")} />
				</ErrorBoundary>
			);

			expect(screen.getByText("Session Expired")).toBeDefined();
			expect(
				screen.getByText("Your session has expired. Please sign in again to continue.")
			).toBeDefined();
			expect(screen.getByRole("button", { name: "Sign In" })).toBeDefined();
		});

		it("detects 'authenticated' keyword case-insensitively", () => {
			render(
				<ErrorBoundary>
					<ThrowingComponent error={new Error("User not AUTHENTICATED")} />
				</ErrorBoundary>
			);

			expect(screen.getByText("Session Expired")).toBeDefined();
		});

		it("shows Sign In button for auth errors instead of Try Again/Reload", () => {
			render(
				<ErrorBoundary>
					<ThrowingComponent error={new Error("Not authenticated")} />
				</ErrorBoundary>
			);

			expect(screen.getByRole("button", { name: "Sign In" })).toBeDefined();
			expect(screen.queryByRole("button", { name: "Try Again" })).toBeNull();
			expect(screen.queryByRole("button", { name: "Reload Page" })).toBeNull();
		});
	});

	describe("error handling callbacks", () => {
		it("calls onError callback when error is caught", () => {
			const onErrorMock = vi.fn();
			const testError = new Error("Test error");

			render(
				<ErrorBoundary onError={onErrorMock}>
					<ThrowingComponent error={testError} />
				</ErrorBoundary>
			);

			expect(onErrorMock).toHaveBeenCalledTimes(1);
			expect(onErrorMock).toHaveBeenCalledWith(
				testError,
				expect.objectContaining({
					componentStack: expect.any(String),
				})
			);
		});

		it("logs error to console", () => {
			const testError = new Error("Test error");

			render(
				<ErrorBoundary>
					<ThrowingComponent error={testError} />
				</ErrorBoundary>
			);

			expect(console.error).toHaveBeenCalledWith(
				"ErrorBoundary caught an error:",
				testError,
				expect.anything()
			);
		});
	});

	describe("recovery actions", () => {
		it("resets error state when Try Again is clicked", () => {
			// Create a stateful component that can toggle error state
			let shouldThrow = true;
			function ConditionallyThrowingComponent() {
				if (shouldThrow) {
					throw new Error("Test error");
				}
				return <div data-testid="recovered-content">Recovered!</div>;
			}

			const { rerender } = render(
				<ErrorBoundary>
					<ConditionallyThrowingComponent />
				</ErrorBoundary>
			);

			// Should show error UI
			expect(screen.getByText("Something went wrong")).toBeDefined();

			// Fix the error condition
			shouldThrow = false;

			// Click Try Again
			fireEvent.click(screen.getByRole("button", { name: "Try Again" }));

			// Re-render to trigger re-evaluation
			rerender(
				<ErrorBoundary>
					<ConditionallyThrowingComponent />
				</ErrorBoundary>
			);

			// Should now show recovered content
			expect(screen.getByTestId("recovered-content")).toBeDefined();
		});

		it("reloads the page when Sign In button is clicked", () => {
			const originalLocation = globalThis.location;
			const mockReload = vi.fn();
			Object.defineProperty(globalThis, "location", {
				value: { ...originalLocation, reload: mockReload },
				writable: true,
			});

			render(
				<ErrorBoundary>
					<ThrowingComponent error={new Error("Not authenticated")} />
				</ErrorBoundary>
			);

			fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

			expect(mockReload).toHaveBeenCalled();

			Object.defineProperty(globalThis, "location", {
				value: originalLocation,
				writable: true,
			});
		});
	});

	describe("edge cases", () => {
		it("handles error with undefined message", () => {
			const getEmptyMessage = () => "";
			const errorWithNoMessage = new Error(getEmptyMessage());

			render(
				<ErrorBoundary>
					<ThrowingComponent error={errorWithNoMessage} />
				</ErrorBoundary>
			);

			expect(screen.getByText("An unexpected error occurred. Please try again.")).toBeDefined();
		});

		it("handles multiple children", () => {
			render(
				<ErrorBoundary>
					<div data-testid="child-1">Child 1</div>
					<div data-testid="child-2">Child 2</div>
				</ErrorBoundary>
			);

			expect(screen.getByTestId("child-1")).toBeDefined();
			expect(screen.getByTestId("child-2")).toBeDefined();
		});

		it("catches errors from nested components", () => {
			render(
				<ErrorBoundary>
					<div>
						<div>
							<ThrowingComponent error={new Error("Nested error")} />
						</div>
					</div>
				</ErrorBoundary>
			);

			expect(screen.getByText("Nested error")).toBeDefined();
		});
	});
});
