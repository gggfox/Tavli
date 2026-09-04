/* eslint-disable boundaries/no-unknown-files */
import "@testing-library/jest-dom/vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
	cleanup();
});

Object.defineProperty(globalThis, "matchMedia", {
	writable: true,
	value: (query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: () => {},
		removeListener: () => {},
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => false,
	}),
});

/**
 * jsdom implements no `IntersectionObserver`, and a component that constructs
 * one throws on mount rather than degrading. The menu's category scroll-spy is
 * the first to need it (TAVLI-98).
 *
 * Deliberately inert: it records nothing and never invokes its callback, so a
 * test sees the component's *initial* state. Faking intersections here would
 * make every consumer's tests depend on a stub's idea of when an element is
 * visible — which jsdom, having no layout, cannot actually know.
 */
class NoopIntersectionObserver implements IntersectionObserver {
	readonly root = null;
	readonly rootMargin = "";
	readonly thresholds: readonly number[] = [];
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
	takeRecords(): IntersectionObserverEntry[] {
		return [];
	}
}

Object.defineProperty(globalThis, "IntersectionObserver", {
	writable: true,
	value: NoopIntersectionObserver,
});
