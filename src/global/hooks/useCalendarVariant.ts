import { useCallback, useSyncExternalStore } from "react";

function getSnapshot(): "custom" | "native" {
	if (typeof globalThis.window === "undefined") return "custom";
	if (globalThis.window.matchMedia("(max-width: 767px)").matches) return "native";
	if (globalThis.window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "native";
	return "custom";
}

function subscribe(onStoreChange: () => void): () => void {
	if (typeof globalThis.window === "undefined") return () => {};
	const mqNarrow = globalThis.window.matchMedia("(max-width: 767px)");
	const mqReduce = globalThis.window.matchMedia("(prefers-reduced-motion: reduce)");
	const handler = () => onStoreChange();
	mqNarrow.addEventListener("change", handler);
	mqReduce.addEventListener("change", handler);
	return () => {
		mqNarrow.removeEventListener("change", handler);
		mqReduce.removeEventListener("change", handler);
	};
}

/**
 * `native` on narrow viewports or when the user prefers reduced motion,
 * so date picking stays reliable on mobile and with system accessibility settings.
 */
export function useCalendarVariant(): "custom" | "native" {
	const getServerSnapshot = useCallback(() => "custom" as const, []);
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
