/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { useConvexAction, useConvexMutation } from "@convex-dev/react-query";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "../hooks/useSession";
import { SubstitutionPrompt } from "./SubstitutionPrompt";

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(),
	useMutation: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: vi.fn((ref, args) => ({ ref, args })),
	useConvexAction: vi.fn(),
	useConvexMutation: vi.fn(),
}));

vi.mock("@stripe/stripe-js", () => ({
	loadStripe: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@stripe/react-stripe-js", () => ({
	Elements: ({ children }: any) => <div data-testid="stripe-elements">{children}</div>,
	PaymentElement: () => <div data-testid="payment-element" />,
	useStripe: () => null,
	useElements: () => null,
}));

const acceptMock = vi.fn(async () => "sub1");
const declineMock = vi.fn(async () => "sub1");
const createIntentMock = vi.fn<() => Promise<{ clientSecret: string | null; paymentId: string }>>(
	async () => ({ clientSecret: null, paymentId: "payments:1" })
);

function baseProposal(overrides: Record<string, any> = {}) {
	return {
		proposalId: "substitutionProposals:1",
		orderId: "orders:1",
		dailyOrderNumber: 7,
		orderItemId: "orderItems:1",
		originalName: "Agua fresca",
		originalLineTotal: 600,
		quantity: 1,
		proposedName: "Molcajete",
		proposedLineTotal: 700,
		deltaAmount: 100,
		feeOnDelta: 12,
		createdAt: 1,
		...overrides,
	};
}

function mockBackend(pending: Record<string, any>[]) {
	vi.mocked(useQuery).mockReturnValue({ data: pending, isLoading: false } as any);
	vi.mocked(useConvexMutation).mockImplementation(
		(ref: any) =>
			(getFunctionName(ref) === "substitutions:acceptProposal" ? acceptMock : declineMock) as any
	);
	vi.mocked(useConvexAction).mockReturnValue(createIntentMock as any);
}

describe("SubstitutionPrompt", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useSessionStore.setState({
			sessionId: "sessions:test" as any,
			restaurantId: "restaurants:test" as any,
		});
	});

	it("renders nothing without pending proposals", () => {
		mockBackend([]);
		const { container } = render(<SubstitutionPrompt />);
		expect(container.firstChild).toBeNull();
	});

	it("shows original vs proposed with the delta + fee-on-delta breakdown", () => {
		mockBackend([baseProposal()]);
		render(<SubstitutionPrompt />);

		expect(screen.getByText("The kitchen suggests a substitution")).toBeTruthy();
		expect(screen.getByText(/Agua fresca is unavailable/)).toBeTruthy();
		expect(screen.getByText(/1x Molcajete/)).toBeTruthy();
		expect(screen.getByText("Price difference")).toBeTruthy();
		expect(screen.getByText("$1.00")).toBeTruthy();
		expect(screen.getByText("Tavli service fee")).toBeTruthy();
		expect(screen.getByText("$0.12")).toBeTruthy();
		expect(screen.getByText("Total extra")).toBeTruthy();
		expect(screen.getByText("$1.12")).toBeTruthy();
	});

	it("accepts a zero-delta proposal via acceptProposal (no payment intent)", async () => {
		mockBackend([
			baseProposal({
				proposedName: "Horchata",
				proposedLineTotal: 600,
				deltaAmount: 0,
				feeOnDelta: 0,
			}),
		]);
		render(<SubstitutionPrompt />);

		expect(screen.getByText("No extra charge")).toBeTruthy();
		fireEvent.click(screen.getByText("Accept substitution"));

		await waitFor(() => {
			expect(acceptMock).toHaveBeenCalledWith({ proposalId: "substitutionProposals:1" });
		});
		expect(createIntentMock).not.toHaveBeenCalled();
	});

	it("accepting a positive delta one-taps the saved card and shows the success card", async () => {
		mockBackend([baseProposal()]);
		createIntentMock.mockResolvedValueOnce({ clientSecret: null, paymentId: "payments:1" });
		render(<SubstitutionPrompt />);

		fireEvent.click(screen.getByText("Accept substitution"));

		await waitFor(() => {
			expect(createIntentMock).toHaveBeenCalledWith({
				proposalId: "substitutionProposals:1",
			});
			expect(screen.getByText(/Your saved card was charged \$1\.12/)).toBeTruthy();
		});
		expect(acceptMock).not.toHaveBeenCalled();
	});

	it("mounts the Elements fallback when the intent returns a client secret", async () => {
		mockBackend([baseProposal()]);
		createIntentMock.mockResolvedValueOnce({
			clientSecret: "cs_sub_test",
			paymentId: "payments:1",
		});
		render(<SubstitutionPrompt />);

		fireEvent.click(screen.getByText("Accept substitution"));

		await waitFor(() => {
			expect(screen.getByTestId("payment-element")).toBeTruthy();
			expect(screen.getByText("Confirm the extra charge")).toBeTruthy();
		});
	});

	it("declining asks for confirmation (mentioning the refund) before declineProposal", async () => {
		mockBackend([baseProposal()]);
		render(<SubstitutionPrompt />);

		fireEvent.click(screen.getByText("No thanks, refund that item"));
		// 600 + round(600 × 12%) = 672 back to the card.
		expect(screen.getByText(/\$6\.72 is refunded to your card/)).toBeTruthy();
		expect(declineMock).not.toHaveBeenCalled();

		fireEvent.click(screen.getByText("Decline and refund"));
		await waitFor(() => {
			expect(declineMock).toHaveBeenCalledWith({ proposalId: "substitutionProposals:1" });
		});
	});

	it("the decline confirm can be backed out of", () => {
		mockBackend([baseProposal()]);
		render(<SubstitutionPrompt />);

		fireEvent.click(screen.getByText("No thanks, refund that item"));
		fireEvent.click(screen.getByText("Go back"));

		expect(screen.getByText("Accept substitution")).toBeTruthy();
		expect(declineMock).not.toHaveBeenCalled();
	});
});
