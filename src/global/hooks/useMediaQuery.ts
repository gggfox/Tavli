import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribes to a CSS media query and returns whether it currently matches.
 * Safe for SSR: `getServerSnapshot` defaults to `false` unless overridden.
 */
export function useMediaQuery(
	query: string,
	getServerSnapshot: () => boolean = () => false
): boolean {
	const subscribe = useCallback((onStoreChange: () => void) => {
		if (typeof globalThis.window === "undefined") return () => {};
		const mq = globalThis.window.matchMedia(query);
		const handler = () => onStoreChange();
		mq.addEventListener("change", handler);
		return () => mq.removeEventListener("change", handler);
	}, [query]);

	const getSnapshot = useCallback(() => {
		if (typeof globalThis.window === "undefined") return false;
		return globalThis.window.matchMedia(query).matches;
	}, [query]);

	return useSyncExternalStore(subscribe, getSnapshot, () => getServerSnapshot());
}

/** Matches `useCalendarVariant` narrow breakpoint (max-width: 767px). */
export function useIsNarrowViewport(): boolean {
	return useMediaQuery("(max-width: 767px)");
}
