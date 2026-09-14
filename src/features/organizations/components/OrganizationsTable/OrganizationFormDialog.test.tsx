/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => ({ update: vi.fn(async () => ["organizations:1", null]) }));
vi.mock("@convex-dev/react-query", () => ({
	useConvexMutation: (ref: any) => (ref?.name === "update" ? hoisted.update : vi.fn()),
}));
vi.mock("@tanstack/react-query", () => ({
	useMutation: ({ mutationFn }: any) => ({ mutateAsync: mutationFn, isPending: false }),
}));
vi.mock("convex/_generated/api", () => ({
	api: {
		organizations: {
			createOrganization: { name: "create" },
			updateOrganization: { name: "update" },
		},
	},
}));

import { OrganizationFormDialog } from "./OrganizationFormDialog";

describe("OrganizationFormDialog", () => {
	beforeEach(() => {
		HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
			this.setAttribute("open", "");
		});
		HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
			this.removeAttribute("open");
		});
	});

	it("saves the AI image monthly limit as a number", async () => {
		render(
			<OrganizationFormDialog
				isOpen
				organization={
					{ _id: "organizations:1", name: "Org", isActive: true, aiImageMonthlyLimit: 100 } as any
				}
				onClose={() => {}}
				onSuccess={() => {}}
			/>
		);
		const input = screen.getByLabelText(/AI images per month/i) as HTMLInputElement;
		expect(input.value).toBe("100");
		fireEvent.change(input, { target: { value: "250" } });
		fireEvent.submit(input.closest("form")!);
		await waitFor(() =>
			expect(hoisted.update).toHaveBeenCalledWith(
				expect.objectContaining({ id: "organizations:1", aiImageMonthlyLimit: 250 })
			)
		);
	});
});
