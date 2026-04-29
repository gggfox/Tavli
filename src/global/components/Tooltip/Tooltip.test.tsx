import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Tooltip } from "./Tooltip";

beforeEach(() => {
	if (!("showPopover" in HTMLElement.prototype)) {
		Object.defineProperty(HTMLElement.prototype, "showPopover", {
			configurable: true,
			value: vi.fn(),
		});
		Object.defineProperty(HTMLElement.prototype, "hidePopover", {
			configurable: true,
			value: vi.fn(),
		});
	}
});

describe("Tooltip", () => {
	it("renders nothing in the document when not hovered or focused", () => {
		render(
			<Tooltip content="Hello tooltip" delay={0}>
				<button type="button">Trigger</button>
			</Tooltip>
		);
		expect(screen.queryByRole("tooltip", { hidden: true })).not.toBeInTheDocument();
	});

	it("opens the tooltip on focus", () => {
		render(
			<Tooltip content="Hello tooltip" delay={0}>
				<button type="button">Trigger</button>
			</Tooltip>
		);
		fireEvent.focus(screen.getByRole("button", { name: "Trigger" }));
		const tooltip = screen.getByRole("tooltip", { hidden: true });
		expect(tooltip).toBeInTheDocument();
		expect(tooltip).toHaveTextContent("Hello tooltip");
	});

	it("closes the tooltip when Escape is pressed", () => {
		render(
			<Tooltip content="Hello tooltip" delay={0}>
				<button type="button">Trigger</button>
			</Tooltip>
		);
		fireEvent.focus(screen.getByRole("button", { name: "Trigger" }));
		expect(screen.getByRole("tooltip", { hidden: true })).toBeInTheDocument();
		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryByRole("tooltip", { hidden: true })).not.toBeInTheDocument();
	});

	it("wires aria-describedby on the trigger to the tooltip id when open", () => {
		render(
			<Tooltip content="Hello tooltip" delay={0}>
				<button type="button">Trigger</button>
			</Tooltip>
		);
		const trigger = screen.getByRole("button", { name: "Trigger" });
		expect(trigger).not.toHaveAttribute("aria-describedby");

		fireEvent.focus(trigger);
		const tooltip = screen.getByRole("tooltip", { hidden: true });
		const tooltipId = tooltip.getAttribute("id");
		expect(tooltipId).toBeTruthy();
		expect(trigger.getAttribute("aria-describedby")).toBe(tooltipId);

		fireEvent.blur(trigger);
		expect(trigger).not.toHaveAttribute("aria-describedby");
	});

	it("does not open when disabled", () => {
		render(
			<Tooltip content="Hello tooltip" delay={0} disabled>
				<button type="button">Trigger</button>
			</Tooltip>
		);
		fireEvent.focus(screen.getByRole("button", { name: "Trigger" }));
		expect(screen.queryByRole("tooltip", { hidden: true })).not.toBeInTheDocument();
	});
});
