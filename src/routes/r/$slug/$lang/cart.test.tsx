/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, boundaries/element-types, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: (_path: string) => (options: any) => ({
		...options,
		useParams: () => ({ slug: "la-taqueria", lang: "es" }),
		useSearch: () => ({ orderId: "orders:draft1" }),
	}),
	useNavigate: () => navigateMock,
}));

vi.mock("@/features/ordering", () => ({
	Cart: ({ onSubmit }: any) => (
		<button onClick={onSubmit} type="button">
			continue-to-payment
		</button>
	),
	useCart: () => ({ removeItem: vi.fn() }),
}));

import { Route } from "./cart";

describe("cart route (ADR 008 pay-at-submit)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("navigates the draft to the per-order checkout instead of submitting to the kitchen", () => {
		const Component = (Route as any).component;
		render(<Component />);

		fireEvent.click(screen.getByText("continue-to-payment"));

		expect(navigateMock).toHaveBeenCalledWith({
			to: "/r/$slug/$lang/checkout",
			params: { slug: "la-taqueria", lang: "es" },
			search: { orderId: "orders:draft1" },
		});
	});
});
