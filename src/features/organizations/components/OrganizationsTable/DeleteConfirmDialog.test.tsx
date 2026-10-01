/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
/**
 * The delete-organization confirmation, in the operator's language.
 *
 * The backend refuses a delete with English prose ("Cannot delete organization
 * with 2 assigned user(s)..."); what is pinned here is that the prose never
 * reaches the screen and the organization's name is shown as data, not parsed
 * as markup.
 */
import { i18n } from "@/global/i18n";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
	remove: vi.fn(async (_args: Record<string, unknown>): Promise<unknown> => [null, null]),
}));
vi.mock("@convex-dev/react-query", () => ({
	useConvexMutation: () => hoisted.remove,
}));
vi.mock("@tanstack/react-query", () => ({
	useMutation: ({ mutationFn }: any) => ({ mutateAsync: mutationFn, isPending: false }),
}));
vi.mock("convex/_generated/api", () => ({
	api: { organizations: { deleteOrganization: { name: "delete" } } },
}));

import { DeleteConfirmDialog } from "./DeleteConfirmDialog";

const ORG = { _id: "organizations:1", name: "<b>Fierro</b> & Co", isActive: true } as any;

describe("DeleteConfirmDialog", () => {
	beforeEach(async () => {
		hoisted.remove.mockReset();
		HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
			this.setAttribute("open", "");
		});
		HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
			this.removeAttribute("open");
		});
		await i18n.changeLanguage("es");
	});

	afterEach(async () => {
		// Unmount first: switching language re-renders anything still mounted.
		cleanup();
		await i18n.changeLanguage("en");
	});

	it("asks in Spanish and shows the organization's name as written", () => {
		render(
			<DeleteConfirmDialog isOpen organization={ORG} onClose={() => {}} onSuccess={() => {}} />
		);

		expect(screen.getByText(/¿Seguro que quieres eliminar/)).toBeInTheDocument();
		expect(screen.getByText("<b>Fierro</b> & Co").tagName).toBe("STRONG");
		expect(screen.getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
	});

	it("explains the assigned-users refusal without the backend's English prose", async () => {
		hoisted.remove.mockResolvedValue([
			null,
			{
				name: "VALIDATION_ERROR",
				message: "id: Cannot delete organization with 2 assigned user(s). Reassign them first.",
			},
		]);
		render(
			<DeleteConfirmDialog isOpen organization={ORG} onClose={() => {}} onSuccess={() => {}} />
		);

		fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));

		await waitFor(() =>
			expect(
				screen.getByText(
					"Esta organización todavía tiene usuarios asignados. Reasígnalos antes de eliminarla."
				)
			).toBeInTheDocument()
		);
		expect(screen.queryByText(/Cannot delete/)).not.toBeInTheDocument();
	});
});
