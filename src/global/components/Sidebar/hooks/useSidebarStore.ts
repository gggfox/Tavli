import { useUserSettings } from "@/features/users/hooks";
import { useConvexAuth } from "convex/react";
import { useEffect } from "react";
import { create } from "zustand";

export const LOCAL_STORAGE_KEY_SIDEBAR_EXPANDED = "sidebar-expanded";

interface SidebarStore {
	isExpanded: boolean;
	setIsExpanded: (expanded: boolean) => void;
}

/**
 * Sidebar state defaults to expanded on both server and client first
 * render so SSR and CSR agree. The actual user preference (from
 * localStorage on first visit, then Convex when authenticated) is
 * synced after hydration via `useSidebarHydration`.
 *
 * The first-paint width still tracks the user's preference: the inline
 * <script> in `__root.tsx` reads localStorage and sets a
 * `data-sidebar-expanded="false"` attribute on `<html>`, which the
 * `Sidebar.css` rule consumes to override Tailwind's `w-60` class. That
 * way the visual width is correct before React hydrates, even though
 * the JS state lags by one effect tick.
 */
export const useSidebarStore = create<SidebarStore>((set) => ({
	isExpanded: true,
	setIsExpanded: (expanded: boolean) => {
		set({ isExpanded: expanded });
		if (globalThis.window !== undefined) {
			globalThis.window.localStorage.setItem(LOCAL_STORAGE_KEY_SIDEBAR_EXPANDED, String(expanded));
			document.documentElement.dataset.sidebarExpanded = String(expanded);
		}
	},
}));

/**
 * Reads the user's saved sidebar-expanded preference once on mount and
 * pushes it into the Zustand store. Avoids the SSR/CSR hydration
 * mismatch that would happen if the store read localStorage at module
 * evaluation time.
 */
export function useSidebarHydration(): void {
	useEffect(() => {
		if (globalThis.window === undefined) return;
		const saved = globalThis.window.localStorage.getItem(LOCAL_STORAGE_KEY_SIDEBAR_EXPANDED);
		if (saved === null) return;
		const value = saved === "true";
		if (value !== useSidebarStore.getState().isExpanded) {
			useSidebarStore.setState({ isExpanded: value });
		}
	}, []);
}

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

	useEffect(() => {
		if (isAuthenticated && settings.settings) {
			if (settings.sidebarExpanded !== storeIsExpanded) {
				setIsExpanded(settings.sidebarExpanded);
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isAuthenticated, settings.settings, settings.sidebarExpanded, storeIsExpanded]);

	const toggleSidebar = async () => {
		const currentState =
			isAuthenticated && settings.settings ? settings.sidebarExpanded : storeIsExpanded;
		const newState = !currentState;

		setIsExpanded(newState);

		if (isAuthenticated) {
			try {
				await settings.updateSidebarExpanded(newState);
			} catch (error) {
				console.error("Failed to update sidebar state:", error);
				setIsExpanded(!newState);
			}
		}
	};

	const isExpanded =
		isAuthenticated && settings.settings ? settings.sidebarExpanded : storeIsExpanded;

	return {
		isExpanded,
		toggleSidebar,
	};
}
