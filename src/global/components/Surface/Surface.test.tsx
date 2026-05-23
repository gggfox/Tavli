import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Surface } from "./Surface";

describe("Surface", () => {
	it("renders children inside a div by default", () => {
		render(<Surface>hello</Surface>);
		const node = screen.getByText("hello");
		expect(node.tagName).toBe("DIV");
	});

	it("applies the secondary background and default border out of the box", () => {
		render(<Surface>content</Surface>);
		const node = screen.getByText("content");
		expect(node.style.backgroundColor).toBe("var(--bg-secondary)");
		expect(node.style.border).toBe("1px solid var(--border-default)");
	});

	it("maps tone to the right CSS var", () => {
		render(<Surface tone="primary">primary</Surface>);
		expect(screen.getByText("primary").style.backgroundColor).toBe("var(--bg-primary)");
	});

	it("omits the background when tone is transparent", () => {
		render(<Surface tone="transparent">no bg</Surface>);
		expect(screen.getByText("no bg").style.backgroundColor).toBe("");
	});

	it("omits the border when bordered is false", () => {
		render(<Surface bordered={false}>borderless</Surface>);
		expect(screen.getByText("borderless").style.border).toBe("");
	});

	it("applies the requested rounding class", () => {
		render(<Surface rounded="xl">xl</Surface>);
		expect(screen.getByText("xl").className).toContain("rounded-xl");
	});

	it("renders as the requested element when `as` is set and forwards extra props", () => {
		const onClick = vi.fn();
		render(
			<Surface as="button" type="button" onClick={onClick}>
				clickable
			</Surface>
		);
		const button = screen.getByRole("button", { name: "clickable" });
		fireEvent.click(button);
		expect(button.tagName).toBe("BUTTON");
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it("merges caller-supplied style on top of computed style", () => {
		render(<Surface style={{ padding: 12 }}>padded</Surface>);
		const node = screen.getByText("padded");
		expect(node.style.padding).toBe("12px");
		expect(node.style.backgroundColor).toBe("var(--bg-secondary)");
	});
});
