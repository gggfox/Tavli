import { describe, expect, it } from "vitest";
import {
	clampAnchoredPopoverLeft,
	resolveAnchoredPopoverPosition,
} from "./anchoredPopoverPosition";

function rect(left: number, top: number, width: number, height: number): DOMRect {
	return {
		left,
		top,
		right: left + width,
		bottom: top + height,
		width,
		height,
		x: left,
		y: top,
		toJSON: () => ({}),
	} as DOMRect;
}

describe("clampAnchoredPopoverLeft", () => {
	it("centers on trigger when there is room", () => {
		expect(clampAnchoredPopoverLeft(500, 320, 1024)).toBe(340);
	});

	it("clamps to right gutter when centered panel would overflow", () => {
		expect(clampAnchoredPopoverLeft(950, 320, 1024)).toBe(696);
	});

	it("clamps to left gutter when centered panel would overflow", () => {
		expect(clampAnchoredPopoverLeft(50, 320, 1024)).toBe(8);
	});
});

describe("resolveAnchoredPopoverPosition", () => {
	it("places below trigger by default", () => {
		const result = resolveAnchoredPopoverPosition({
			triggerRect: rect(800, 100, 120, 32),
			panelRect: rect(0, 0, 320, 280),
			viewportWidth: 1024,
			viewportHeight: 768,
		});

		expect(result.placement).toBe("bottom");
		expect(result.top).toBe(140);
		expect(result.left).toBe(696);
	});

	it("flips above trigger when below would overflow viewport", () => {
		const result = resolveAnchoredPopoverPosition({
			triggerRect: rect(800, 700, 120, 32),
			panelRect: rect(0, 0, 320, 280),
			viewportWidth: 1024,
			viewportHeight: 768,
		});

		expect(result.placement).toBe("top");
		expect(result.top).toBe(412);
	});
});
