import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSidebarStore, useToggleSidebar } from "./useSidebarStore";

const updateSidebarExpanded = vi.fn(async (_expanded: boolean) => {});

vi.mock("@/features/users/hooks", () => ({
	useUserSettings: () => ({
		settings: {},
		sidebarExpanded: true,
		updateSidebarExpanded,
	}),
}));

vi.mock("convex/react", () => ({
	useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));

const originalMatchMedia = globalThis.matchMedia;

/** Evaluates the min/max-width queries `useSidebarViewport` asks for. */
function setViewportWidth(width: number) {
	globalThis.matchMedia = ((query: string) => {
		const min = /min-width:\s*(\d+)px/.exec(query);
		const max = /max-width:\s*(\d+)px/.exec(query);
		const matches = (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
		return {
			matches,
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		};
	}) as typeof globalThis.matchMedia;
}

describe("useToggleSidebar", () => {
	beforeEach(() => {
		const storage = new Map<string, string>();
		vi.stubGlobal("localStorage", {
			getItem: (k: string) => storage.get(k) ?? null,
			setItem: (k: string, v: string) => storage.set(k, v),
			removeItem: (k: string) => storage.delete(k),
		});
		useSidebarStore.setState({ isExpanded: true, overlayOpen: false });
		updateSidebarExpanded.mockClear();
	});

	afterEach(() => {
		globalThis.matchMedia = originalMatchMedia;
		vi.unstubAllGlobals();
	});

	it("on a phone the menu opens and closes as a drawer without touching the saved preference", async () => {
		setViewportWidth(390);
		const { result } = renderHook(() => useToggleSidebar());

		expect(result.current.viewport).toBe("phone");
		// The drawer always renders the full sidebar, never the rail.
		expect(result.current.isExpanded).toBe(true);
		expect(result.current.overlayOpen).toBe(false);

		await act(() => result.current.toggleSidebar());
		expect(result.current.overlayOpen).toBe(true);

		await act(() => result.current.toggleSidebar());
		expect(result.current.overlayOpen).toBe(false);
		expect(updateSidebarExpanded).not.toHaveBeenCalled();
	});

	it("on a tablet the rail stays collapsed until opened, and opening it is not persisted", async () => {
		setViewportWidth(820);
		const { result } = renderHook(() => useToggleSidebar());

		expect(result.current.viewport).toBe("tablet");
		expect(result.current.isExpanded).toBe(false);

		await act(() => result.current.toggleSidebar());
		expect(result.current.isExpanded).toBe(true);
		expect(result.current.overlayOpen).toBe(true);

		act(() => result.current.closeOverlay());
		expect(result.current.isExpanded).toBe(false);
		expect(updateSidebarExpanded).not.toHaveBeenCalled();
	});

	it("on desktop the toggle still saves the collapsed preference", async () => {
		setViewportWidth(1440);
		const { result } = renderHook(() => useToggleSidebar());

		expect(result.current.viewport).toBe("desktop");
		expect(result.current.isExpanded).toBe(true);

		await act(() => result.current.toggleSidebar());
		expect(updateSidebarExpanded).toHaveBeenCalledWith(false);
		expect(result.current.overlayOpen).toBe(false);
	});
});
