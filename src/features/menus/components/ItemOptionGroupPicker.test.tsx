/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ItemEditForm } from "./ItemEditForm";

const { mutationSpy } = vi.hoisted(() => ({ mutationSpy: vi.fn() }));

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(),
	useMutation: vi.fn(({ mutationFn }: any) => ({ mutateAsync: mutationFn, isPending: false })),
}));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: vi.fn((ref, args) => ({ ref, args })),
	useConvexMutation: vi.fn((ref) => {
		const name = getFunctionName(ref);
		return (args: any) => mutationSpy(name, args);
	}),
}));

// The full option-group editor is exercised by its own surface; here we only
// care that the item edit panel can reach it.
vi.mock("./OptionGroupManagerModal", () => ({
	OptionGroupManagerModal: ({ isOpen }: any) => (isOpen ? <p>Option group manager</p> : null),
}));

const CUT_GROUP = {
	_id: "optionGroups:cut",
	name: "Cut",
	selectionType: "single",
	displayOrder: 0,
};
const SIDES_GROUP = {
	_id: "optionGroups:sides",
	name: "Sides",
	selectionType: "multi",
	displayOrder: 1,
};

/**
 * TAVLI-79: option groups used to be a panel that was mutually exclusive with
 * the edit panel, so a manager editing "Rib Eye" saw no trace of them. These
 * assertions are on the *edit panel*, not the picker in isolation -- being
 * reachable from there is the whole point.
 */
describe("ItemEditForm option groups", () => {
	function renderEditPanel() {
		return render(
			<ItemEditForm
				itemId={"menuItems:ribEye" as any}
				restaurantId={"restaurants:test" as any}
				currentName="Rib Eye"
				currentDescription=""
				currentPrice={45000}
				currentPrepStation="kitchen"
				onSave={async () => {}}
				onClose={() => {}}
			/>
		);
	}

	function mockQueries(allGroups: unknown[], linkedGroups: unknown[]) {
		const byName: Record<string, unknown> = {
			"optionGroups:getGroupsByRestaurant": allGroups,
			"optionGroups:getGroupsForMenuItem": linkedGroups,
		};
		vi.mocked(useQuery).mockImplementation((options: any) => {
			const name = options?.ref ? getFunctionName(options.ref) : "";
			return { data: byName[name], isPending: false, isError: false } as any;
		});
	}

	beforeEach(() => {
		vi.clearAllMocks();
		mutationSpy.mockImplementation(async (name: string) => {
			if (name === "optionGroups:createGroup") return ["optionGroups:new", null];
			return [null, null];
		});
		mockQueries([CUT_GROUP, SIDES_GROUP], [CUT_GROUP]);
	});

	it("shows the item's option groups without leaving the edit panel", () => {
		renderEditPanel();

		// The item's own fields and its specifications are on screen together.
		expect(screen.getByDisplayValue("Rib Eye")).toBeTruthy();
		expect(screen.getByText("Specifications (option groups)")).toBeTruthy();

		const cut = screen.getByRole("button", { name: /Cut/ });
		const sides = screen.getByRole("button", { name: /Sides/ });
		expect(cut.getAttribute("aria-pressed")).toBe("true");
		expect(sides.getAttribute("aria-pressed")).toBe("false");
	});

	it("links an option group straight from the edit panel", async () => {
		renderEditPanel();

		fireEvent.click(screen.getByRole("button", { name: /Sides/ }));

		await waitFor(() => {
			expect(mutationSpy).toHaveBeenCalledWith("optionGroups:linkToMenuItem", {
				menuItemId: "menuItems:ribEye",
				optionGroupId: "optionGroups:sides",
				restaurantId: "restaurants:test",
			});
		});
	});

	it("unlinks an option group that is already linked", async () => {
		renderEditPanel();

		fireEvent.click(screen.getByRole("button", { name: /Cut/ }));

		await waitFor(() => {
			expect(mutationSpy).toHaveBeenCalledWith("optionGroups:unlinkFromMenuItem", {
				menuItemId: "menuItems:ribEye",
				optionGroupId: "optionGroups:cut",
			});
		});
	});

	it("offers an inline way out when the restaurant has no option groups", async () => {
		mockQueries([], []);
		renderEditPanel();

		// The old copy pointed at a button in a different panel -- a dead end.
		expect(screen.getByText(/No option groups yet/)).toBeTruthy();
		expect(screen.queryByText(/button above/)).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /New Option Group/ }));
		const nameInput = screen.getByPlaceholderText(/Group name/);
		fireEvent.change(nameInput, { target: { value: "Cut" } });
		fireEvent.submit(nameInput.closest("form") as HTMLFormElement);

		await waitFor(() => {
			expect(mutationSpy).toHaveBeenCalledWith(
				"optionGroups:createGroup",
				expect.objectContaining({ name: "Cut", restaurantId: "restaurants:test" })
			);
		});
		// A group created from inside an item is linked to it right away, so
		// the manager never has to go hunting for it afterwards.
		await waitFor(() => {
			expect(mutationSpy).toHaveBeenCalledWith("optionGroups:linkToMenuItem", {
				menuItemId: "menuItems:ribEye",
				optionGroupId: "optionGroups:new",
				restaurantId: "restaurants:test",
			});
		});
	});

	it("opens the full option group editor from the edit panel", () => {
		renderEditPanel();

		expect(screen.queryByText("Option group manager")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /Edit groups and choices/ }));
		expect(screen.getByText("Option group manager")).toBeTruthy();
	});
});
