/* eslint-disable boundaries/no-unknown-files, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CategoryTileRail } from "./CategoryTileRail";

const categories = [
	{ _id: "meats", name: "Meats", displayOrder: 1 },
	{ _id: "soups", name: "Soups", displayOrder: 2 },
] as any;

describe("CategoryTileRail", () => {
	it("shows a photo tile where the category has one and an initial where it does not", () => {
		render(
			<CategoryTileRail
				categories={categories}
				tileImages={new Map([["meats", "https://x/rib.jpg"]])}
				onJump={() => {}}
			/>
		);
		const meats = screen.getByRole("button", { name: /Meats/ });
		const soups = screen.getByRole("button", { name: /Soups/ });
		expect(meats.querySelector("img")?.getAttribute("src")).toBe("https://x/rib.jpg");
		expect(soups.querySelector("img")).toBeNull();
		expect(soups.textContent).toMatch(/^S/);
	});

	it("jumps to the tapped category", () => {
		const onJump = vi.fn();
		render(<CategoryTileRail categories={categories} tileImages={new Map()} onJump={onJump} />);
		fireEvent.click(screen.getByRole("button", { name: /Meats/ }));
		expect(onJump).toHaveBeenCalledWith("meats");
	});
});
