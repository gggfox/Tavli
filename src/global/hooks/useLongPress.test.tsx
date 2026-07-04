import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useLongPress } from "./useLongPress";

function LongPressTarget({
	onLongPress,
	onCancel,
	delay = 100,
}: {
	onLongPress: () => void;
	onCancel?: () => void;
	delay?: number;
}) {
	const handlers = useLongPress({ onLongPress, onCancel, delay });
	return (
		<div data-testid="target" {...handlers}>
			Target
		</div>
	);
}

function touchStart(el: Element, x: number, y: number) {
	fireEvent.touchStart(el, {
		touches: [{ clientX: x, clientY: y }],
	});
}

function touchMove(el: Element, x: number, y: number) {
	fireEvent.touchMove(el, {
		touches: [{ clientX: x, clientY: y }],
	});
}

describe("useLongPress", () => {
	it("fires onLongPress after the delay", () => {
		vi.useFakeTimers();
		const onLongPress = vi.fn();
		render(<LongPressTarget onLongPress={onLongPress} delay={500} />);
		const target = screen.getByTestId("target");

		touchStart(target, 10, 10);
		expect(onLongPress).not.toHaveBeenCalled();

		vi.advanceTimersByTime(500);
		expect(onLongPress).toHaveBeenCalledTimes(1);
		vi.useRealTimers();
	});

	it("does not fire when touch ends before the delay", () => {
		vi.useFakeTimers();
		const onLongPress = vi.fn();
		render(<LongPressTarget onLongPress={onLongPress} delay={500} />);
		const target = screen.getByTestId("target");

		touchStart(target, 10, 10);
		vi.advanceTimersByTime(200);
		fireEvent.touchEnd(target);
		vi.advanceTimersByTime(400);

		expect(onLongPress).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it("calls onCancel after a completed long press is released", () => {
		vi.useFakeTimers();
		const onLongPress = vi.fn();
		const onCancel = vi.fn();
		render(<LongPressTarget onLongPress={onLongPress} onCancel={onCancel} delay={100} />);
		const target = screen.getByTestId("target");

		touchStart(target, 10, 10);
		vi.advanceTimersByTime(100);
		expect(onLongPress).toHaveBeenCalledTimes(1);

		fireEvent.touchEnd(target);
		expect(onCancel).toHaveBeenCalledTimes(1);
		vi.useRealTimers();
	});

	it("cancels when the finger moves beyond the threshold", () => {
		vi.useFakeTimers();
		const onLongPress = vi.fn();
		render(<LongPressTarget onLongPress={onLongPress} delay={500} />);
		const target = screen.getByTestId("target");

		touchStart(target, 10, 10);
		touchMove(target, 30, 10);
		vi.advanceTimersByTime(500);

		expect(onLongPress).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it("prevents context menu after a long press", () => {
		vi.useFakeTimers();
		const onLongPress = vi.fn();
		render(<LongPressTarget onLongPress={onLongPress} delay={100} />);
		const target = screen.getByTestId("target");

		touchStart(target, 10, 10);
		vi.advanceTimersByTime(100);

		fireEvent.contextMenu(target);

		expect(onLongPress).toHaveBeenCalledTimes(1);
		vi.useRealTimers();
	});
});
