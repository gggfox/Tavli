import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DialogHeader } from "./DialogHeader";

describe("DialogHeader", () => {
	it("renders the title and the close button", () => {
		render(<DialogHeader title="Settings" onClose={() => {}} />);
		expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
	});

	it("renders a string subtitle as a <p>", () => {
		render(<DialogHeader title="t" subtitle="some details" onClose={() => {}} />);
		expect(screen.getByText("some details").tagName).toBe("P");
	});

	it("calls onClose when the close button is clicked", () => {
		const onClose = vi.fn();
		render(<DialogHeader title="t" onClose={onClose} />);
		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("uses a custom close ARIA label when provided", () => {
		render(<DialogHeader title="t" onClose={() => {}} closeAriaLabel="Close drawer" />);
		expect(screen.getByRole("button", { name: "Close drawer" })).toBeInTheDocument();
	});

	it("renders extra content alongside the close button", () => {
		render(
			<DialogHeader title="t" onClose={() => {}} extra={<span>EXTRA</span>} />
		);
		expect(screen.getByText("EXTRA")).toBeInTheDocument();
	});

	it("renders ReactNode title without wrapping it in <h2>", () => {
		render(
			<DialogHeader
				title={<span data-testid="custom-title">Custom</span>}
				onClose={() => {}}
			/>
		);
		expect(screen.getByTestId("custom-title")).toBeInTheDocument();
		expect(screen.queryByRole("heading")).not.toBeInTheDocument();
	});
});
