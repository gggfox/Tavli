import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchInput } from "./SearchInput";

describe("SearchInput", () => {
	it("renders with the given placeholder", () => {
		render(<SearchInput placeholder="Search items..." value="" onChange={() => {}} />);
		expect(screen.getByPlaceholderText("Search items...")).toBeInTheDocument();
	});

	it("displays the current value", () => {
		render(<SearchInput placeholder="Search" value="pizza" onChange={() => {}} />);
		const input = screen.getByPlaceholderText("Search") as HTMLInputElement;
		expect(input.value).toBe("pizza");
	});

	it("calls onChange with the new value when user types", () => {
		const onChange = vi.fn();
		render(<SearchInput placeholder="Search" value="" onChange={onChange} />);

		const input = screen.getByPlaceholderText("Search");
		fireEvent.change(input, { target: { value: "burger" } });
		expect(onChange).toHaveBeenCalledWith("burger");
	});

	it("renders a text input element", () => {
		render(<SearchInput placeholder="Search" value="" onChange={() => {}} />);
		const input = screen.getByPlaceholderText("Search") as HTMLInputElement;
		expect(input.type).toBe("text");
	});
});
