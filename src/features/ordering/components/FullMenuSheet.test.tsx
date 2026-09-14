/* eslint-disable boundaries/no-unknown-files, @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FullMenuSheet } from "./FullMenuSheet";

const categories = [
	{ _id: "meats", name: "Meats", displayOrder: 1 },
	{ _id: "soups", name: "Soups", displayOrder: 2 },
] as any;

describe("FullMenuSheet", () => {
	it("renders nothing while closed", () => {
		const { container } = render(
			<FullMenuSheet
				open={false}
				categories={categories}
				counts={new Map()}
				activeId={null}
				onJump={() => {}}
				onClose={() => {}}
			/>
		);
		expect(container.firstChild).toBeNull();
	});

	it("lists every category with its count when open", () => {
		render(
			<FullMenuSheet
				open
				categories={categories}
				counts={new Map([["meats", 3]])}
				activeId={null}
				onJump={() => {}}
				onClose={() => {}}
			/>
		);
		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(screen.getByRole("button", { name: /Meats\s*3/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /Soups/ })).toBeTruthy();
	});

	it("jumps and closes on a tap", () => {
		const onJump = vi.fn();
		const onClose = vi.fn();
		render(
			<FullMenuSheet
				open
				categories={categories}
				counts={new Map()}
				activeId={null}
				onJump={onJump}
				onClose={onClose}
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: /Soups/ }));
		expect(onJump).toHaveBeenCalledWith("soups");
		expect(onClose).toHaveBeenCalled();
	});

	it("closes from its close button", () => {
		const onClose = vi.fn();
		render(
			<FullMenuSheet
				open
				categories={categories}
				counts={new Map()}
				activeId={null}
				onJump={() => {}}
				onClose={onClose}
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: /close menu/i }));
		expect(onClose).toHaveBeenCalled();
	});
});
