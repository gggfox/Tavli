/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ItemOptionGroupsBadge", () => ({ ItemOptionGroupsBadge: () => null }));
vi.mock("./MenuItemImagePreview", () => ({
	MenuItemImagePreview: () => <span data-testid="thumb" />,
}));

import { MenuItemRow } from "./MenuItemRow";

const ITEM = {
	_id: "menuItems:1",
	name: "Picaña",
	basePrice: 80000,
	isAvailable: true,
	prepStation: "kitchen",
} as any;

function setup(overrides: Partial<Parameters<typeof MenuItemRow>[0]> = {}) {
	const props = {
		item: ITEM,
		isSelected: false,
		isEditing: false,
		onToggleSelect: vi.fn(),
		onEdit: vi.fn(),
		onToggleAvailability: vi.fn(),
		onRemove: vi.fn(),
		...overrides,
	};
	render(<MenuItemRow {...props} />);
	return props;
}

describe("MenuItemRow", () => {
	beforeEach(() => vi.clearAllMocks());

	it("has no checkbox input: the row itself is the selection control", () => {
		setup({ isSelected: true });
		expect(document.querySelector("input[type=checkbox]")).toBeNull();
		expect(screen.getByRole("checkbox", { name: "Picaña" }).getAttribute("aria-checked")).toBe(
			"true"
		);
	});

	it("a click on the row toggles selection and passes Shift through", () => {
		const props = setup();
		fireEvent.click(screen.getByText("Picaña"), { shiftKey: true });
		expect(props.onToggleSelect).toHaveBeenCalledWith({ shiftKey: true });
		fireEvent.click(screen.getByTestId("thumb"));
		expect(props.onToggleSelect).toHaveBeenCalledTimes(2);
	});

	it("row actions do not select", () => {
		const props = setup();
		fireEvent.click(screen.getByRole("button", { name: /edit item/i }));
		fireEvent.click(screen.getByRole("button", { name: /mark unavailable/i }));
		expect(props.onEdit).toHaveBeenCalledTimes(1);
		expect(props.onToggleAvailability).toHaveBeenCalledWith({ itemId: "menuItems:1" });
		expect(props.onToggleSelect).not.toHaveBeenCalled();
	});

	it("double-click and Enter edit; Space selects", () => {
		const props = setup();
		const row = screen.getByRole("checkbox", { name: "Picaña" });
		fireEvent.doubleClick(screen.getByText("Picaña"));
		fireEvent.keyDown(row, { key: "Enter" });
		fireEvent.keyDown(row, { key: " " });
		expect(props.onEdit).toHaveBeenCalledTimes(2);
		expect(props.onToggleSelect).toHaveBeenCalledWith({ shiftKey: false });
	});
});
