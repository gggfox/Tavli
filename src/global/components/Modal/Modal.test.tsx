import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal";

beforeEach(() => {
	HTMLDialogElement.prototype.showModal = vi.fn();
	HTMLDialogElement.prototype.close = vi.fn();
});

describe("Modal", () => {
	it("renders nothing when isOpen is false", () => {
		const { container } = render(
			<Modal isOpen={false} onClose={() => {}}>
				<p>Content</p>
			</Modal>
		);
		expect(container.innerHTML).toBe("");
	});

	it("renders children when isOpen is true", () => {
		render(
			<Modal isOpen={true} onClose={() => {}}>
				<p>Hello Modal</p>
			</Modal>
		);
		expect(screen.getByText("Hello Modal")).toBeInTheDocument();
	});

	it("renders a dialog element with aria-label", () => {
		render(
			<Modal isOpen={true} onClose={() => {}} ariaLabel="Settings">
				<p>Body</p>
			</Modal>
		);
		const dialog = screen.getByRole("dialog", { hidden: true });
		expect(dialog).toBeInTheDocument();
		expect(dialog).toHaveAttribute("aria-label", "Settings");
	});

	it("calls onClose on backdrop keydown Escape", () => {
		const onClose = vi.fn();
		render(
			<Modal isOpen={true} onClose={onClose}>
				<p>Body</p>
			</Modal>
		);
		const backdrop = screen.getByRole("none", { hidden: true });
		fireEvent.keyDown(backdrop, { key: "Escape" });
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("does not call onClose on Escape when closeOnEscape is false", () => {
		const onClose = vi.fn();
		render(
			<Modal isOpen={true} onClose={onClose} closeOnEscape={false}>
				<p>Body</p>
			</Modal>
		);
		const backdrop = screen.getByRole("none", { hidden: true });
		fireEvent.keyDown(backdrop, { key: "Escape" });
		expect(onClose).not.toHaveBeenCalled();
	});

	it("calls onClose when clicking the backdrop directly", () => {
		const onClose = vi.fn();
		render(
			<Modal isOpen={true} onClose={onClose}>
				<p>Body</p>
			</Modal>
		);
		const backdrop = screen.getByRole("none", { hidden: true });
		fireEvent.click(backdrop);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("does not call onClose when clicking content inside the backdrop", () => {
		const onClose = vi.fn();
		render(
			<Modal isOpen={true} onClose={onClose}>
				<p>Body</p>
			</Modal>
		);
		fireEvent.click(screen.getByText("Body"));
		expect(onClose).not.toHaveBeenCalled();
	});

	it("does not call onClose on backdrop click when closeOnBackdropClick is false", () => {
		const onClose = vi.fn();
		render(
			<Modal isOpen={true} onClose={onClose} closeOnBackdropClick={false}>
				<p>Body</p>
			</Modal>
		);
		const backdrop = screen.getByRole("none", { hidden: true });
		fireEvent.click(backdrop);
		expect(onClose).not.toHaveBeenCalled();
	});
});
