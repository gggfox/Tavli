/* eslint-disable boundaries/no-unknown-files, @typescript-eslint/no-explicit-any */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useScrolledPast } from "./useScrolledPast";

function rect(el: HTMLElement, top: number, bottom: number) {
	el.getBoundingClientRect = () =>
		({
			top,
			bottom,
			left: 0,
			right: 100,
			width: 100,
			height: bottom - top,
			x: 0,
			y: top,
			toJSON() {},
		}) as any;
}

describe("useScrolledPast", () => {
	it("flips to true once the target's bottom edge has scrolled above the container's top", async () => {
		const root = document.createElement("div");
		const target = document.createElement("div");
		root.appendChild(target);
		document.body.appendChild(root);
		rect(root, 0, 600);
		rect(target, 100, 200);

		const { result } = renderHook(() => useScrolledPast({ current: target }, { current: root }));
		expect(result.current).toBe(false);

		rect(target, -150, -50);
		act(() => {
			root.dispatchEvent(new Event("scroll"));
		});
		await waitFor(() => expect(result.current).toBe(true));
		root.remove();
	});
});
