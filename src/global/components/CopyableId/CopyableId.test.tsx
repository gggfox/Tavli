import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopyableId } from "./CopyableId";

const FULL_ID = "abcdefghijklmnop1234567890";

describe("CopyableId", () => {
	let writeTextMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.useFakeTimers();
		writeTextMock = vi.fn().mockResolvedValue(undefined);
		Object.assign(navigator, {
			clipboard: { writeText: writeTextMock },
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("renders the id truncated to truncateLength chars with ellipsis", () => {
		render(<CopyableId id={FULL_ID} truncateLength={8} />);
		expect(screen.getByText("abcdefgh...")).toBeInTheDocument();
	});

	it("does not truncate when id is shorter than truncateLength", () => {
		render(<CopyableId id="short" truncateLength={12} />);
		expect(screen.getByText("short")).toBeInTheDocument();
	});

	it("shows the full id in a tooltip on hover", () => {
		render(<CopyableId id={FULL_ID} />);
		const button = screen.getByRole("button", { name: /Copy ID/ });
		fireEvent.mouseEnter(button);
		const tooltip = screen.getByRole("tooltip");
		expect(tooltip).toHaveTextContent(FULL_ID);
	});

	it("hides the tooltip when the cursor leaves the button", () => {
		render(<CopyableId id={FULL_ID} />);
		const button = screen.getByRole("button", { name: /Copy ID/ });
		fireEvent.mouseEnter(button);
		expect(screen.getByRole("tooltip")).toBeInTheDocument();
		fireEvent.mouseLeave(button);
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
	});

	it("copies the full id to the clipboard when clicked", async () => {
		render(<CopyableId id={FULL_ID} />);
		const button = screen.getByRole("button", { name: /Copy ID/ });
		fireEvent.click(button);
		expect(writeTextMock).toHaveBeenCalledWith(FULL_ID);
	});

	it("swaps the tooltip to the success message after copying", async () => {
		render(<CopyableId id={FULL_ID} />);
		const button = screen.getByRole("button", { name: /Copy ID/ });

		await act(async () => {
			fireEvent.click(button);
		});

		expect(button).toHaveAccessibleName(`ID ${FULL_ID} copied to clipboard`);

		fireEvent.mouseEnter(button);
		expect(screen.getByRole("tooltip")).toHaveTextContent("Copied!");
	});

	it("stops propagating the click so it cannot trigger React ancestor handlers", async () => {
		const ancestorClick = vi.fn();
		const noop = () => {};
		render(
			<div role="button" tabIndex={0} onClick={ancestorClick} onKeyDown={noop}>
				<CopyableId id={FULL_ID} />
			</div>
		);
		const copyButton = screen.getByRole("button", { name: /Copy ID/ });

		await act(async () => {
			fireEvent.click(copyButton);
		});

		expect(writeTextMock).toHaveBeenCalledWith(FULL_ID);
		expect(ancestorClick).not.toHaveBeenCalled();
	});
});
