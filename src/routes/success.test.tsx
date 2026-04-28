/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { render, screen } from "@testing-library/react";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
	};
});

import { Route, SuccessPage } from "./success";

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: vi.fn(() => ({ queryKey: ["mock"], queryFn: () => null })),
}));

describe("SuccessPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(Route, "useSearch").mockReturnValue({
			session_id: "cs_test_success",
			payment_id: "payments:test",
		} as any);
	});

	it("shows server-confirmed success when the storefront payment succeeded", () => {
		vi.mocked(useQuery).mockReturnValue({
			data: {
				status: "succeeded",
			},
			isLoading: false,
		} as any);

		render(<SuccessPage />);

		expect(screen.getByText("Payment Successful!")).toBeTruthy();
		expect(screen.getByText("Your payment has been confirmed successfully.")).toBeTruthy();
	});

	it("shows a non-success state when the payment cannot be verified", () => {
		vi.mocked(useQuery).mockReturnValue({
			data: {
				status: "not_found",
			},
			isLoading: false,
		} as any);

		render(<SuccessPage />);

		expect(screen.getByText("Unable to Verify Payment")).toBeTruthy();
		expect(
			screen.getByText(
				"We could not verify this checkout session. If you were charged, please contact support."
			)
		).toBeTruthy();
		expect(screen.queryByText("Session ID")).toBeNull();
		expect(convexQuery).toHaveBeenCalled();
	});
});
