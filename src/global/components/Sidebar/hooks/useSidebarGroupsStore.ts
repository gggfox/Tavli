import { useUserSettings } from "@/features/users/hooks";
import { useConvexAuth } from "convex/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { create } from "zustand";

export const LOCAL_STORAGE_KEY_EXPANDED_SIDEBAR_GROUPS = "sidebar-groups-expanded";

interface SidebarGroupsStore {
	expandedGroups: Set<string>;
	setGroupExpanded: (key: string, expanded: boolean) => void;
	hydrateFromArray: (groups: readonly string[]) => void;
}

/**
 * Persists which sidebar accordion groups (e.g. "sidebar.team",
 * "sidebar.admin") the current user has open. Mirrors the
 * `useSidebarStore` pattern: empty Set on SSR/first paint, then
 * hydrated from localStorage and reconciled with Convex once
 * authenticated.
 *
 * Group identity uses each group's `translationKey` so we don't have to
 * thread a separate id through the sidebar item definitions. Unknown
 * keys (e.g. from a removed group) are silently ignored at render time.
 */
export const useSidebarGroupsStore = create<SidebarGroupsStore>((set) => ({
	expandedGroups: new Set<string>(),
	setGroupExpanded: (key: string, expanded: boolean) => {
		set((state) => {
			const next = new Set(state.expandedGroups);
			if (expanded) {
				next.add(key);
			} else {
				next.delete(key);
			}
			if (globalThis.window !== undefined) {
				globalThis.window.localStorage.setItem(
					LOCAL_STORAGE_KEY_EXPANDED_SIDEBAR_GROUPS,
					JSON.stringify(Array.from(next))
				);
			}
			return { expandedGroups: next };
		});
	},
	hydrateFromArray: (groups: readonly string[]) => {
		set({ expandedGroups: new Set(groups) });
	},
}));

function readGroupsFromLocalStorage(): string[] | null {
	if (globalThis.window === undefined) return null;
	const raw = globalThis.window.localStorage.getItem(LOCAL_STORAGE_KEY_EXPANDED_SIDEBAR_GROUPS);
	if (raw === null) return null;
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return null;
		return parsed.filter((entry): entry is string => typeof entry === "string");
	} catch {
		return null;
	}
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
	if (a.size !== b.size) return false;
	for (const value of a) {
		if (!b.has(value)) return false;
	}
	return true;
}

function writeGroupsToLocalStorage(groups: readonly string[]): void {
	if (globalThis.window === undefined) return;
	globalThis.window.localStorage.setItem(
		LOCAL_STORAGE_KEY_EXPANDED_SIDEBAR_GROUPS,
		JSON.stringify(Array.from(groups))
	);
}

/**
 * Reads the user's saved expanded-groups preference once on mount and
 * pushes it into the Zustand store. Avoids the SSR/CSR hydration
 * mismatch that would happen if the store read localStorage at module
 * evaluation time.
 */
export function useSidebarGroupsHydration(): void {
	useEffect(() => {
		const saved = readGroupsFromLocalStorage();
		if (saved === null) return;
		const current = useSidebarGroupsStore.getState().expandedGroups;
		const next = new Set(saved);
		if (!setsEqual(current, next)) {
			useSidebarGroupsStore.setState({ expandedGroups: next });
		}
	}, []);
}

export type UseSidebarGroupsReturn = {
	isOpen: (key: string) => boolean;
	setGroupExpanded: (key: string, expanded: boolean) => void;
	toggleGroup: (key: string) => void;
};

/**
 * Hook to access and toggle the per-user expanded-groups state.
 *
 * - Reads a live `Set<string>` from the Zustand store so any component
 *   subscribing to the same group key re-renders together.
 * - On first authenticated load, hydrates the local store from the
 *   Convex `userSettings` document. After that, the local store is the
 *   source of truth and toggles flow outward to Convex (and
 *   localStorage). We deliberately do NOT keep mirroring Convex back
 *   into the local store on every echo, because consecutive in-flight
 *   mutations can echo intermediate states that would clobber the
 *   user's optimistic toggles and make groups appear to close.
 * - When unauthenticated, falls back to localStorage only.
 */
export function useSidebarGroups(): UseSidebarGroupsReturn {
	const expandedGroups = useSidebarGroupsStore((state) => state.expandedGroups);
	const storeSetGroupExpanded = useSidebarGroupsStore((state) => state.setGroupExpanded);
	const { isAuthenticated } = useConvexAuth();
	const {
		settings,
		expandedSidebarGroups: settingsGroups,
		setSidebarGroupExpanded,
	} = useUserSettings();

	const hasHydratedFromConvexRef = useRef(false);
	useEffect(() => {
		if (!isAuthenticated) {
			// Reset on logout so a subsequent re-login re-hydrates from
			// the freshly-loaded Convex settings.
			hasHydratedFromConvexRef.current = false;
			return;
		}
		if (!settings || hasHydratedFromConvexRef.current) return;

		hasHydratedFromConvexRef.current = true;
		const remote = new Set(settingsGroups);
		const local = useSidebarGroupsStore.getState().expandedGroups;
		if (!setsEqual(local, remote)) {
			useSidebarGroupsStore.setState({ expandedGroups: remote });
			writeGroupsToLocalStorage(settingsGroups);
		}
	}, [isAuthenticated, settings, settingsGroups]);

	const isOpen = useCallback((key: string) => expandedGroups.has(key), [expandedGroups]);

	const setGroupExpanded = useCallback(
		(key: string, expanded: boolean) => {
			const wasOpen = useSidebarGroupsStore.getState().expandedGroups.has(key);
			if (wasOpen === expanded) return;

			storeSetGroupExpanded(key, expanded);

			if (isAuthenticated) {
				setSidebarGroupExpanded(key, expanded).catch((error) => {
					console.error("Failed to persist sidebar group state:", error);
					// Roll back local store on failure so the visible state
					// matches what's actually persisted.
					storeSetGroupExpanded(key, wasOpen);
				});
			}
		},
		[isAuthenticated, setSidebarGroupExpanded, storeSetGroupExpanded]
	);

	const toggleGroup = useCallback(
		(key: string) => {
			const wasOpen = useSidebarGroupsStore.getState().expandedGroups.has(key);
			setGroupExpanded(key, !wasOpen);
		},
		[setGroupExpanded]
	);

	return useMemo(
		() => ({ isOpen, setGroupExpanded, toggleGroup }),
		[isOpen, setGroupExpanded, toggleGroup]
	);
}
