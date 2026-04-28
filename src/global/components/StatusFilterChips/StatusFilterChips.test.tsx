import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { StatusFilterChips, type StatusFilterOption } from "./StatusFilterChips";

type Status = "pending" | "confirmed" | "completed" | "cancelled";

const OPTIONS: ReadonlyArray<StatusFilterOption<Status>> = [
	{ value: "pending", label: "Pending", tone: "warning" },
	{ value: "confirmed", label: "Confirmed", tone: "info" },
	{ value: "completed", label: "Completed", tone: "neutral" },
	{ value: "cancelled", label: "Cancelled", tone: "danger" },
];

describe("StatusFilterChips", () => {
	it("renders every option as a labelled button inside the group", () => {
		render(
			<StatusFilterChips
				options={OPTIONS}
				selected={new Set<Status>()}
				onToggle={() => {}}
				ariaLabel="Filter by status"
			/>
		);

		expect(screen.getByRole("group", { name: "Filter by status" })).toBeInTheDocument();
		for (const option of OPTIONS) {
			expect(screen.getByRole("button", { name: option.label })).toBeInTheDocument();
		}
	});

	it("marks selected options with aria-pressed=true and others with aria-pressed=false", () => {
		render(
			<StatusFilterChips
				options={OPTIONS}
				selected={new Set<Status>(["pending", "confirmed"])}
				onToggle={() => {}}
				ariaLabel="Filter by status"
			/>
		);

		expect(screen.getByRole("button", { name: "Pending" })).toHaveAttribute(
			"aria-pressed",
			"true"
		);
		expect(screen.getByRole("button", { name: "Confirmed" })).toHaveAttribute(
			"aria-pressed",
			"true"
		);
		expect(screen.getByRole("button", { name: "Completed" })).toHaveAttribute(
			"aria-pressed",
			"false"
		);
		expect(screen.getByRole("button", { name: "Cancelled" })).toHaveAttribute(
			"aria-pressed",
			"false"
		);
	});

	it("invokes onToggle with the clicked option's value", () => {
		const onToggle = vi.fn();
		render(
			<StatusFilterChips
				options={OPTIONS}
				selected={new Set<Status>()}
				onToggle={onToggle}
				ariaLabel="Filter by status"
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "Confirmed" }));
		expect(onToggle).toHaveBeenCalledWith("confirmed");
	});

	it("supports multi-select (toggling does not deselect other options)", () => {
		function Harness() {
			const [selected, setSelected] = useState<Set<Status>>(new Set());
			return (
				<StatusFilterChips
					options={OPTIONS}
					selected={selected}
					onToggle={(value) => {
						setSelected((prev) => {
							const next = new Set(prev);
							if (next.has(value)) next.delete(value);
							else next.add(value);
							return next;
						});
					}}
					ariaLabel="Filter by status"
				/>
			);
		}
		render(<Harness />);

		fireEvent.click(screen.getByRole("button", { name: "Pending" }));
		fireEvent.click(screen.getByRole("button", { name: "Cancelled" }));

		expect(screen.getByRole("button", { name: "Pending" })).toHaveAttribute(
			"aria-pressed",
			"true"
		);
		expect(screen.getByRole("button", { name: "Cancelled" })).toHaveAttribute(
			"aria-pressed",
			"true"
		);
		expect(screen.getByRole("button", { name: "Completed" })).toHaveAttribute(
			"aria-pressed",
			"false"
		);

		fireEvent.click(screen.getByRole("button", { name: "Pending" }));
		expect(screen.getByRole("button", { name: "Pending" })).toHaveAttribute(
			"aria-pressed",
			"false"
		);
		expect(screen.getByRole("button", { name: "Cancelled" })).toHaveAttribute(
			"aria-pressed",
			"true"
		);
	});

	it("uses the tinted tone background when inactive and the solid tone fill when active", () => {
		render(
			<StatusFilterChips
				options={OPTIONS}
				selected={new Set<Status>(["confirmed"])}
				onToggle={() => {}}
				ariaLabel="Filter by status"
			/>
		);

		const confirmed = screen.getByRole("button", { name: "Confirmed" });
		expect(confirmed.style.backgroundColor).toBe("var(--accent-info)");
		expect(confirmed.style.color).toBe("rgb(255, 255, 255)");

		const pending = screen.getByRole("button", { name: "Pending" });
		expect(pending.style.backgroundColor).toBe("var(--accent-warning-light)");
		expect(pending.style.color).toBe("var(--accent-warning)");
	});

	it("renders Completed (neutral) and Cancelled (danger) with distinct styles", () => {
		render(
			<StatusFilterChips
				options={OPTIONS}
				selected={new Set<Status>()}
				onToggle={() => {}}
				ariaLabel="Filter by status"
			/>
		);

		const completed = screen.getByRole("button", { name: "Completed" });
		const cancelled = screen.getByRole("button", { name: "Cancelled" });

		expect(completed.style.backgroundColor).not.toBe(cancelled.style.backgroundColor);
		expect(completed.style.color).not.toBe(cancelled.style.color);
	});
});
