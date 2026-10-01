/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => ({
	update: vi.fn(
		async (_args: Record<string, unknown>): Promise<unknown> => ["organizations:1", null]
	),
}));
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
		hoisted.update.mockClear();
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

	it("does not send the AI image limit when it is left unchanged", async () => {
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
		fireEvent.submit(input.closest("form")!);
		await waitFor(() => expect(hoisted.update).toHaveBeenCalled());
		expect(hoisted.update.mock.calls[0][0]).not.toHaveProperty("aiImageMonthlyLimit");
	});

	it("does not send the AI image limit when the field is blanked", async () => {
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
		fireEvent.change(input, { target: { value: "" } });
		fireEvent.submit(input.closest("form")!);
		await waitFor(() => expect(hoisted.update).toHaveBeenCalled());
		expect(hoisted.update.mock.calls[0][0]).not.toHaveProperty("aiImageMonthlyLimit");
	});
	it.each([
		["name: ERROR_ORGANIZATION_NAME_TAKEN", "Name", "Another organization already uses that name."],
		[
			"aiImageMonthlyLimit: ERROR_ORGANIZATION_AI_IMAGE_LIMIT_INVALID",
			"AI images per month (0 = off)",
			"Enter a whole number from 0 to 100,000.",
		],
	])("shows the backend's %s refusal under its field", async (message, label, expected) => {
		hoisted.update.mockResolvedValueOnce([null, { name: "VALIDATION_ERROR", message }]);
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
		const input = screen.getByLabelText(label, { exact: false }) as HTMLInputElement;
		fireEvent.submit(input.closest("form")!);
		await waitFor(() => expect(screen.getByText(expected)).toBeInTheDocument());
		expect(screen.queryByText(/ERROR_/)).not.toBeInTheDocument();
	});
});
