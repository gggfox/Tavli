import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
	it("renders children with the primary variant by default", () => {
		render(<Button>Save</Button>);
		const button = screen.getByRole("button", { name: /save/i });
		expect(button).toBeInTheDocument();
		expect(button.className).toContain("hover-btn-primary");
		expect(button.className).toContain("tavli-button");
		expect(button.dataset.state).toBe("idle");
	});

	it("applies the requested variant and size classes", () => {
		render(
			<Button variant="danger" size="lg">
				Delete
			</Button>
		);
		const button = screen.getByRole("button", { name: /delete/i });
		expect(button.className).toContain("hover-btn-danger");
		expect(button.className).toContain("px-6");
		expect(button.dataset.size).toBe("lg");
		expect(button.dataset.variant).toBe("danger");
	});

	it("forwards extra button props (type, disabled, aria-label, ref)", () => {
		const ref = { current: null as HTMLButtonElement | null };
		render(
			<Button
				ref={(node) => {
					ref.current = node;
				}}
				type="submit"
				aria-label="custom"
				disabled
			>
				go
			</Button>
		);
		const button = screen.getByRole("button", { name: "custom" });
		expect(button).toBeDisabled();
		expect(button.getAttribute("type")).toBe("submit");
		expect(ref.current).toBe(button);
	});

	it("stretches to full width when fullWidth is set", () => {
		render(<Button fullWidth>wide</Button>);
		expect(screen.getByRole("button", { name: /wide/i }).className).toContain("w-full");
	});

	it("calls onClick on press", () => {
		const onClick = vi.fn();
		render(<Button onClick={onClick}>click</Button>);
		fireEvent.click(screen.getByRole("button", { name: /click/i }));
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	describe("controlled state", () => {
		it("renders aria-busy and disables the button when state=loading", () => {
			render(
				<Button state="loading" loadingLabel="Saving...">
					Save
				</Button>
			);
			const button = screen.getByRole("button");
			expect(button).toBeDisabled();
			expect(button.getAttribute("aria-busy")).toBe("true");
			expect(button.dataset.state).toBe("loading");
		});

		it("shows the success label and announces it via aria-live when state=success", () => {
			render(
				<Button state="success" successLabel="All saved">
					Save
				</Button>
			);
			const button = screen.getByRole("button");
			expect(button.dataset.state).toBe("success");
			expect(screen.getAllByText("All saved").length).toBeGreaterThan(0);
			const liveRegion = button.querySelector("[aria-live='polite']");
			expect(liveRegion?.textContent).toBe("All saved");
		});

		it("shows the error label and announces it when state=error", () => {
			render(
				<Button state="error" errorLabel="Save failed">
					Save
				</Button>
			);
			const button = screen.getByRole("button");
			expect(button.dataset.state).toBe("error");
			const liveRegion = button.querySelector("[aria-live='polite']");
			expect(liveRegion?.textContent).toBe("Save failed");
		});
	});

	describe("auto-drive from promise", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("transitions loading → success → idle when onClick resolves", async () => {
			const onClick = vi.fn().mockReturnValue(Promise.resolve());
			const onStateReset = vi.fn();
			render(
				<Button
					onClick={onClick}
					onStateReset={onStateReset}
					successDuration={1500}
					successLabel="Saved!"
				>
					Save
				</Button>
			);
			const button = screen.getByRole("button", { name: /save/i });

			await act(async () => {
				fireEvent.click(button);
			});
			expect(button.dataset.state).toBe("success");

			await act(async () => {
				vi.advanceTimersByTime(1500);
			});
			expect(button.dataset.state).toBe("idle");
			expect(onStateReset).toHaveBeenCalledTimes(1);
		});

		it("transitions loading → error → idle when onClick rejects", async () => {
			const onClick = vi.fn().mockReturnValue(Promise.reject(new Error("nope")));
			render(
				<Button onClick={onClick} errorDuration={2000} errorLabel="Failed">
					Save
				</Button>
			);
			const button = screen.getByRole("button", { name: /save/i });

			await act(async () => {
				fireEvent.click(button);
			});
			expect(button.dataset.state).toBe("error");

			await act(async () => {
				vi.advanceTimersByTime(2000);
			});
			expect(button.dataset.state).toBe("idle");
		});

		it("ignores clicks while loading", async () => {
			let resolve: (() => void) | null = null;
			const onClick = vi.fn(
				() =>
					new Promise<void>((res) => {
						resolve = res;
					})
			);
			render(<Button onClick={onClick}>Save</Button>);
			const button = screen.getByRole("button", { name: /save/i });

			await act(async () => {
				fireEvent.click(button);
			});
			expect(button.dataset.state).toBe("loading");

			fireEvent.click(button);
			fireEvent.click(button);
			expect(onClick).toHaveBeenCalledTimes(1);

			await act(async () => {
				resolve?.();
				await Promise.resolve();
			});
			expect(button.dataset.state).toBe("success");
		});

		it("does not auto-drive state for synchronous handlers", () => {
			const onClick = vi.fn();
			render(<Button onClick={onClick}>Save</Button>);
			const button = screen.getByRole("button", { name: /save/i });
			fireEvent.click(button);
			expect(button.dataset.state).toBe("idle");
		});

		it("respects controlled state and does not auto-drive from a promise", async () => {
			const onClick = vi.fn().mockReturnValue(Promise.resolve());
			render(
				<Button state="idle" onClick={onClick}>
					Save
				</Button>
			);
			const button = screen.getByRole("button", { name: /save/i });

			await act(async () => {
				fireEvent.click(button);
			});
			expect(button.dataset.state).toBe("idle");
		});
	});
});
