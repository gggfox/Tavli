/* eslint-disable boundaries/no-unknown-files, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CategoryRail } from "./CategoryRail";

const categories = [
	{ _id: "meats", name: "Meats", displayOrder: 1 },
	{ _id: "soups", name: "Soups", displayOrder: 2 },
] as any;

describe("CategoryRail", () => {
	it("lists every category with how many dishes it has today", () => {
		render(
			<CategoryRail
				categories={categories}
				counts={
					new Map([
						["meats", 3],
						["soups", 2],
					])
				}
				activeId="meats"
				onJump={() => {}}
			/>
		);
		expect(screen.getByRole("button", { name: /Meats\s*3/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /Soups\s*2/ })).toBeTruthy();
	});

	it("marks the section the diner is in", () => {
		render(
			<CategoryRail categories={categories} counts={new Map()} activeId="soups" onJump={() => {}} />
		);
		expect(screen.getByRole("button", { name: /Soups/ }).getAttribute("aria-current")).toBe("true");
		expect(screen.getByRole("button", { name: /Meats/ }).getAttribute("aria-current")).toBeNull();
	});

	it("jumps to the tapped category", () => {
		const onJump = vi.fn();
		render(
			<CategoryRail categories={categories} counts={new Map()} activeId={null} onJump={onJump} />
		);
		fireEvent.click(screen.getByRole("button", { name: /Soups/ }));
		expect(onJump).toHaveBeenCalledWith("soups");
	});
});
