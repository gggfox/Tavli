import { useUserSettings } from "@/features/users/hooks";
import { useConvexAuth } from "convex/react";
import { useEffect } from "react";
import { create } from "zustand";

const LOCAL_STORAGE_KEY_SIDEBAR_EXPANDED = "sidebar-expanded";

interface SidebarStore {
	isExpanded: boolean;
	setIsExpanded: (expanded: boolean) => void;
}

// Initialize from localStorage
const getInitialState = (): boolean => {
	if (globalThis.window === undefined) return true;
	const saved = globalThis.window.localStorage.getItem(LOCAL_STORAGE_KEY_SIDEBAR_EXPANDED);
	if (saved === null) return true;
	return saved === "true";
};

export const useSidebarStore = create<SidebarStore>((set) => ({
	isExpanded: getInitialState(),
	setIsExpanded: (expanded: boolean) => {
		set({ isExpanded: expanded });
		if (globalThis.window !== undefined) {
			globalThis.window.localStorage.setItem(LOCAL_STORAGE_KEY_SIDEBAR_EXPANDED, String(expanded));
		}
	},
}));

/**
 * Hook to access and toggle sidebar state.
 * Syncs with Convex user settings when authenticated.
 * All components using this hook will share the same sidebar state via Zustand.
 */
export function useToggleSidebar() {
	const storeIsExpanded = useSidebarStore((state) => state.isExpanded);
	const setIsExpanded = useSidebarStore((state) => state.setIsExpanded);
	const settings = useUserSettings();
	const { isAuthenticated } = useConvexAuth();

	// Sync Zustand store with Convex settings when authenticated
	useEffect(() => {
		if (isAuthenticated && settings.settings) {
			// If Convex has a different value, sync it to the store
			if (settings.sidebarExpanded !== storeIsExpanded) {
				setIsExpanded(settings.sidebarExpanded);
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		isAuthenticated,
		settings.settings,
		settings.sidebarExpanded,
		storeIsExpanded,
		// setIsExpanded is excluded from dependencies as it's a stable Zustand setter
		// that doesn't need to trigger re-runs of this effect
	]);

	// Enhanced toggle that syncs with Convex
	const toggleSidebar = async () => {
		const currentState =
			isAuthenticated && settings.settings ? settings.sidebarExpanded : storeIsExpanded;
		const newState = !currentState;

		// Update store immediately (optimistic update)
		setIsExpanded(newState);

		// Sync with Convex if authenticated
		if (isAuthenticated) {
			const result = await settings.updateSidebarExpanded(newState);
			if (!result.success) {
				console.error("Failed to update sidebar state:", result.error);
				// Revert to previous state on error
				setIsExpanded(!newState);
			}
		}
	};

	// Use Convex settings when authenticated, otherwise use Zustand store
	const isExpanded =
		isAuthenticated && settings.settings ? settings.sidebarExpanded : storeIsExpanded;

	return {
		isExpanded,
		toggleSidebar,
	};
}
