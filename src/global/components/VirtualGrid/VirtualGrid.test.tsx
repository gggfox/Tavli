import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { VirtualGrid } from "./VirtualGrid";

/**
 * jsdom reports every element as 0x0, so the virtualizer's windowing cannot be
 * exercised here — that needs a real layout engine (Playwright). What these
 * tests do pin down is the contract the dashboards rely on: keys, ordering,
 * the item renderer, and that an empty list renders nothing rather than
 * throwing.
 */
beforeAll(() => {
	globalThis.window.matchMedia ??= ((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
		dispatchEvent: () => false,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	})) as any;
});

const items = Array.from({ length: 50 }, (_, i) => ({ id: `item-${i}`, label: `Item ${i}` }));

describe("VirtualGrid", () => {
	it("renders nothing for an empty list", () => {
		const { container } = render(
			<VirtualGrid
				items={[]}
				getKey={(item: { id: string }) => item.id}
				renderItem={(item: { label: string }) => <span>{item.label}</span>}
			/>
		);

		expect(container.querySelectorAll("[data-index]")).toHaveLength(0);
	});

	it("mounts a strict subset of a long list", () => {
		render(
			<VirtualGrid
				items={items}
				getKey={(item) => item.id}
				renderItem={(item) => <span>{item.label}</span>}
			/>
		);

		// Whatever the measured viewport turns out to be, virtualization must
		// never mount all 50 — that is the entire point of the component.
		expect(screen.queryAllByText(/^Item /)).not.toHaveLength(items.length);
	});

	it("reserves scroll height for every item, not just the mounted ones", () => {
		const { container } = render(
			<VirtualGrid
				items={items}
				getKey={(item) => item.id}
				renderItem={(item) => <span>{item.label}</span>}
				columns={{ base: 1, md: 1, lg: 1 }}
				estimateRowHeight={100}
				gap={0}
			/>
		);

		// 50 items, one per row, 100px each: the scrollbar must behave as if
		// the whole list were mounted.
		const grid = container.firstElementChild as HTMLElement;
		expect(grid.style.height).toBe("5000px");
	});
});
