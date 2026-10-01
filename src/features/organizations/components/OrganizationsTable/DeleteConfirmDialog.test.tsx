/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
/**
 * The delete-organization confirmation, in the operator's language.
 *
 * The backend refuses a delete with a stable code that carries how many users
 * are still assigned (`"id: ERROR_ORGANIZATION_HAS_USERS:2"`); what is pinned
 * here is that the count reaches the localized message, the raw code never
 * reaches the screen, and the organization's name is shown as data, not parsed
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

	it.each([
		[
			"id: ERROR_ORGANIZATION_HAS_USERS:2",
			"Esta organización todavía tiene 2 usuarios asignados. Reasígnalos antes de eliminarla.",
		],
		[
			"id: ERROR_ORGANIZATION_HAS_USERS:1",
			"Esta organización todavía tiene 1 usuario asignado. Reasígnalo antes de eliminarla.",
		],
		[
			"id: ERROR_ORGANIZATION_HAS_USERS",
			"Esta organización todavía tiene usuarios asignados. Reasígnalos antes de eliminarla.",
		],
	])("explains the assigned-users refusal %s with its count", async (message, expected) => {
		hoisted.remove.mockResolvedValue([null, { name: "VALIDATION_ERROR", message }]);
		render(
			<DeleteConfirmDialog isOpen organization={ORG} onClose={() => {}} onSuccess={() => {}} />
		);

		fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));

		await waitFor(() => expect(screen.getByText(expected)).toBeInTheDocument());
		expect(screen.queryByText(/ERROR_/)).not.toBeInTheDocument();
	});

	it("names a vanished organization instead of the generic failure", async () => {
		hoisted.remove.mockResolvedValue([
			null,
			{ name: "NOT_FOUND", message: "ERROR_ORGANIZATION_NOT_FOUND" },
		]);
		render(
			<DeleteConfirmDialog isOpen organization={ORG} onClose={() => {}} onSuccess={() => {}} />
		);

		fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));

		await waitFor(() =>
			expect(screen.getByText("Esa organización ya no existe.")).toBeInTheDocument()
		);
	});
});
