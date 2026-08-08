/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubstitutionProposalDialog, type SubstitutionTarget } from "./SubstitutionProposalDialog";

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: vi.fn((ref, args) => ({ ref, args })),
}));

const target: SubstitutionTarget = {
	orderId: "orders:1" as any,
	orderItemId: "orderItems:1" as any,
	menuItemId: "menuItems:drink" as any,
	menuItemName: "Agua fresca",
	quantity: 1,
	lineTotal: 600,
};

function menuItem(id: string, name: string, basePrice: number) {
	return { _id: id, name, basePrice, isAvailable: true };
}

function mockMenuItems(items: Record<string, any>[]) {
	vi.mocked(useQuery).mockReturnValue({ data: items, isLoading: false } as any);
}

describe("SubstitutionProposalDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("lists only equal-or-higher-priced items (and never the line's own item)", () => {
		mockMenuItems([
			menuItem("menuItems:drink", "Agua fresca", 600),
			menuItem("menuItems:cheap", "Limonada", 500),
			menuItem("menuItems:equal", "Horchata", 600),
			menuItem("menuItems:higher", "Molcajete", 700),
		]);
		render(
			<SubstitutionProposalDialog
				restaurantId={"restaurants:1" as any}
				target={target}
				onClose={() => {}}
				onPropose={vi.fn()}
			/>
		);

		// The cheaper item and the item being replaced are filtered out.
		expect(screen.queryByText(/Limonada/)).toBeNull();
		expect(screen.queryByText(/Agua fresca \$/)).toBeNull();
		expect(screen.getByText("Horchata")).toBeTruthy();
		expect(screen.getByText("Molcajete")).toBeTruthy();
	});

	it("previews the delta plus the service fee on the delta", () => {
		mockMenuItems([
			menuItem("menuItems:equal", "Horchata", 600),
			menuItem("menuItems:higher", "Molcajete", 700),
		]);
		render(
			<SubstitutionProposalDialog
				restaurantId={"restaurants:1" as any}
				target={target}
				onClose={() => {}}
				onPropose={vi.fn()}
			/>
		);

		// Equal swap → free; +100 → +$1.00 delta with +$0.12 fee-on-delta.
		expect(screen.getByText("No extra charge")).toBeTruthy();
		expect(screen.getByText("+$1.00 (+$0.12 service fee)")).toBeTruthy();
	});

	it("proposes the selected item and closes", async () => {
		mockMenuItems([menuItem("menuItems:higher", "Molcajete", 700)]);
		const onPropose = vi.fn(async () => null);
		const onClose = vi.fn();
		render(
			<SubstitutionProposalDialog
				restaurantId={"restaurants:1" as any}
				target={target}
				onClose={onClose}
				onPropose={onPropose}
			/>
		);

		// Confirm is disabled until an item is picked.
		const confirm = screen.getByText("Send to diner").closest("button")!;
		expect(confirm.hasAttribute("disabled")).toBe(true);

		fireEvent.click(screen.getByText("Molcajete"));
		fireEvent.click(confirm);

		await waitFor(() => {
			expect(onPropose).toHaveBeenCalledWith({
				orderId: "orders:1",
				orderItemId: "orderItems:1",
				proposedMenuItemId: "menuItems:higher",
			});
			expect(onClose).toHaveBeenCalled();
		});
	});

	it("shows the empty state when nothing qualifies", () => {
		mockMenuItems([menuItem("menuItems:cheap", "Limonada", 500)]);
		render(
			<SubstitutionProposalDialog
				restaurantId={"restaurants:1" as any}
				target={target}
				onClose={() => {}}
				onPropose={vi.fn()}
			/>
		);
		expect(screen.getByText("No available items at this price or above.")).toBeTruthy();
	});
});
