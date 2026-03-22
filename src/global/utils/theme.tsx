import { useConvexAuth } from "convex/react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useUserSettings } from "../../features/users/hooks/useUserSettings";

export const Theme = {
	LIGHT: "light",
	DARK: "dark",
} as const;

export type Theme = (typeof Theme)[keyof typeof Theme];
const LOCAL_STORAGE_THEME_KEY = "fierro-viejo-theme";

function isUndefined(value: unknown): value is undefined {
	return value === undefined;
}

function isDefined(value: unknown): value is NonNullable<unknown> {
	return value !== null && value !== undefined;
}

/**
 * Hook to access theme state and actions.
 * Uses Convex settings when authenticated, falls back to localStorage when not.
 */
export function useTheme() {
	const { isAuthenticated } = useConvexAuth();
	const settings = useUserSettings();
	const [localTheme, setLocalTheme] = useState<Theme>(() => {
		if (isUndefined(globalThis.window)) return Theme.LIGHT;
		const saved = globalThis.window.localStorage.getItem(LOCAL_STORAGE_THEME_KEY);
		return saved === Theme.DARK ? Theme.DARK : Theme.LIGHT;
	});

	const saveTheme = useCallback((newTheme: Theme) => {
		setLocalTheme(newTheme);
		if (isDefined(globalThis.window)) {
			globalThis.window.localStorage.setItem(LOCAL_STORAGE_THEME_KEY, newTheme);
		}
	}, []);

	// Use Convex settings when authenticated, otherwise use localStorage
	const theme = useMemo<Theme>(() => {
		if (isAuthenticated && settings.settings) {
			return settings.theme;
		}
		return localTheme;
	}, [isAuthenticated, settings.settings, settings.theme, localTheme]);

	const setTheme = useCallback(
		async (newTheme: Theme) => {
			if (!isAuthenticated) {
				saveTheme(newTheme);
				return;
			}
			const result = await settings.updateTheme(newTheme);
			if (!result.success) {
				console.error("Failed to update theme:", result.error);
				saveTheme(newTheme);
			}
		},
		[isAuthenticated, settings, saveTheme]
	);

	const toggleTheme = useCallback(async () => {
		const newTheme = theme === Theme.LIGHT ? Theme.DARK : Theme.LIGHT;
		await setTheme(newTheme);
	}, [theme, setTheme]);

	return { theme, setTheme, toggleTheme };
}

/**
 * Provider component that syncs theme state with the DOM.
 * Still needed to apply the theme class to the document root.
 */
export function ThemeProvider({ children }: Readonly<{ children: ReactNode }>) {
	const { theme } = useTheme();

	// Apply theme class to document
	useEffect(() => {
		const root = document.documentElement;
		if (theme === Theme.DARK) {
			root.classList.add(Theme.DARK);
		} else {
			root.classList.remove(Theme.DARK);
		}
	}, [theme]);

	return <>{children}</>;
}
