import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./SegmentedControl";

type Range = "today" | "week" | "month";

const OPTIONS: ReadonlyArray<{ value: Range; label: string }> = [
	{ value: "today", label: "Today" },
	{ value: "week", label: "This week" },
	{ value: "month", label: "This month" },
];

describe("SegmentedControl", () => {
	it("renders all options inside a labelled radiogroup", () => {
		render(
			<SegmentedControl
				options={OPTIONS}
				value="today"
				onChange={() => {}}
				ariaLabel="Filter by range"
			/>
		);

		const group = screen.getByRole("radiogroup", { name: "Filter by range" });
		expect(group).toBeInTheDocument();

		for (const option of OPTIONS) {
			expect(screen.getByRole("radio", { name: option.label })).toBeInTheDocument();
		}
	});

	it("marks the active option with aria-checked and the others as unchecked", () => {
		render(
			<SegmentedControl
				options={OPTIONS}
				value="week"
				onChange={() => {}}
				ariaLabel="Filter by range"
			/>
		);

		expect(screen.getByRole("radio", { name: "Today" })).toHaveAttribute("aria-checked", "false");
		expect(screen.getByRole("radio", { name: "This week" })).toHaveAttribute(
			"aria-checked",
			"true"
		);
		expect(screen.getByRole("radio", { name: "This month" })).toHaveAttribute(
			"aria-checked",
			"false"
		);
	});

	it("uses a roving tabindex so only the active option is in the tab order", () => {
		render(
			<SegmentedControl
				options={OPTIONS}
				value="week"
				onChange={() => {}}
				ariaLabel="Filter by range"
			/>
		);

		expect(screen.getByRole("radio", { name: "Today" })).toHaveAttribute("tabindex", "-1");
		expect(screen.getByRole("radio", { name: "This week" })).toHaveAttribute("tabindex", "0");
		expect(screen.getByRole("radio", { name: "This month" })).toHaveAttribute("tabindex", "-1");
	});

	it("calls onChange with the clicked option's value", () => {
		const onChange = vi.fn();
		render(
			<SegmentedControl
				options={OPTIONS}
				value="today"
				onChange={onChange}
				ariaLabel="Filter by range"
			/>
		);

		fireEvent.click(screen.getByRole("radio", { name: "This month" }));
		expect(onChange).toHaveBeenCalledWith("month");
	});

	it("moves selection right and wraps with ArrowRight", () => {
		function Harness() {
			const [value, setValue] = useState<Range>("today");
			return (
				<SegmentedControl
					options={OPTIONS}
					value={value}
					onChange={setValue}
					ariaLabel="Filter by range"
				/>
			);
		}
		render(<Harness />);

		const today = screen.getByRole("radio", { name: "Today" });
		fireEvent.keyDown(today, { key: "ArrowRight" });
		expect(screen.getByRole("radio", { name: "This week" })).toHaveAttribute(
			"aria-checked",
			"true"
		);

		const week = screen.getByRole("radio", { name: "This week" });
		fireEvent.keyDown(week, { key: "ArrowRight" });
		expect(screen.getByRole("radio", { name: "This month" })).toHaveAttribute(
			"aria-checked",
			"true"
		);

		const month = screen.getByRole("radio", { name: "This month" });
		fireEvent.keyDown(month, { key: "ArrowRight" });
		expect(screen.getByRole("radio", { name: "Today" })).toHaveAttribute("aria-checked", "true");
	});

	it("moves selection left and wraps with ArrowLeft", () => {
		function Harness() {
			const [value, setValue] = useState<Range>("today");
			return (
				<SegmentedControl
					options={OPTIONS}
					value={value}
					onChange={setValue}
					ariaLabel="Filter by range"
				/>
			);
		}
		render(<Harness />);

		const today = screen.getByRole("radio", { name: "Today" });
		fireEvent.keyDown(today, { key: "ArrowLeft" });
		expect(screen.getByRole("radio", { name: "This month" })).toHaveAttribute(
			"aria-checked",
			"true"
		);
	});

	it("fills the active segment with its tone's solid palette", () => {
		render(
			<SegmentedControl
				options={[
					{ value: "today", label: "Today", tone: "warning" },
					{ value: "week", label: "This week", tone: "success" },
				]}
				value="today"
				onChange={() => {}}
				ariaLabel="Filter by range"
			/>
		);

		const active = screen.getByRole("radio", { name: "Today" });
		expect(active.style.backgroundColor).toBe("var(--accent-warning)");
		expect(active.style.color).toBe("var(--text-on-accent)");

		// Inactive toned segments keep a transparent background but take the
		// tone's foreground, matching StatusFilterChips' inactive treatment.
		const inactive = screen.getByRole("radio", { name: "This week" });
		expect(inactive.style.backgroundColor).toBe("transparent");
		expect(inactive.style.color).toBe("var(--accent-success)");
	});

	it("keeps the neutral primary-button styling when no tone is given", () => {
		render(
			<SegmentedControl
				options={OPTIONS}
				value="today"
				onChange={() => {}}
				ariaLabel="Filter by range"
			/>
		);

		const active = screen.getByRole("radio", { name: "Today" });
		expect(active.style.backgroundColor).toBe("var(--btn-primary-bg)");
		expect(active.style.color).toBe("var(--btn-primary-text)");
	});

	it("jumps to the first option on Home and the last on End", () => {
		function Harness() {
			const [value, setValue] = useState<Range>("week");
			return (
				<SegmentedControl
					options={OPTIONS}
					value={value}
					onChange={setValue}
					ariaLabel="Filter by range"
				/>
			);
		}
		render(<Harness />);

		const week = screen.getByRole("radio", { name: "This week" });
		fireEvent.keyDown(week, { key: "Home" });
		expect(screen.getByRole("radio", { name: "Today" })).toHaveAttribute("aria-checked", "true");

		const today = screen.getByRole("radio", { name: "Today" });
		fireEvent.keyDown(today, { key: "End" });
		expect(screen.getByRole("radio", { name: "This month" })).toHaveAttribute(
			"aria-checked",
			"true"
		);
	});
});
