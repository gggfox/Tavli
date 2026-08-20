/* eslint-disable boundaries/no-unknown-files, boundaries/no-unknown, @typescript-eslint/no-explicit-any */
import { render, screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ItemOptionGroupsBadge } from "./ItemOptionGroupsBadge";

vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn() }));

vi.mock("@convex-dev/react-query", () => ({
	convexQuery: vi.fn((ref, args) => ({ ref, args })),
}));

describe("ItemOptionGroupsBadge", () => {
	it("names the linked option groups on the row", () => {
		vi.mocked(useQuery).mockReturnValue({
			data: [
				{ _id: "optionGroups:cut", name: "Cut" },
				null,
				{ _id: "optionGroups:x", name: "Temp" },
			],
		} as any);

		render(<ItemOptionGroupsBadge itemId={"menuItems:ribEye" as any} />);

		// Names, not just a dot: the row says *which* specifications an item has.
		expect(screen.getByText("Cut, Temp")).toBeTruthy();
	});

	it("renders nothing when the item has no option groups", () => {
		vi.mocked(useQuery).mockReturnValue({ data: [] } as any);

		const { container } = render(<ItemOptionGroupsBadge itemId={"menuItems:soup" as any} />);

		expect(container.textContent).toBe("");
	});
});
