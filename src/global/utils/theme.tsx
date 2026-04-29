import { useConvexAuth } from "convex/react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";

export const Theme = {
	LIGHT: "light",
	DARK: "dark",
} as const;

export type Theme = (typeof Theme)[keyof typeof Theme];
export const LOCAL_STORAGE_THEME_KEY = "tavli-theme";
const LEGACY_LOCAL_STORAGE_THEME_KEY = "fierro-viejo-theme";

/**
 * Reads the saved theme value from localStorage. If only the legacy
 * `fierro-viejo-theme` key is present (pre-rename), copies it into the
 * canonical `tavli-theme` key once and removes the legacy entry.
 */
function readSavedTheme(): string | null {
	const storage = globalThis.window?.localStorage;
	if (!storage) return null;
	try {
		const saved = storage.getItem(LOCAL_STORAGE_THEME_KEY);
		if (saved !== null) return saved;
		const legacy = storage.getItem(LEGACY_LOCAL_STORAGE_THEME_KEY);
		if (legacy !== null) {
			storage.setItem(LOCAL_STORAGE_THEME_KEY, legacy);
			storage.removeItem(LEGACY_LOCAL_STORAGE_THEME_KEY);
			return legacy;
		}
		return null;
	} catch {
		return null;
	}
}

function readInitialTheme(): Theme {
	if (globalThis.window === undefined) return Theme.LIGHT;
	try {
		const saved = readSavedTheme();
		if (saved === Theme.DARK) return Theme.DARK;
		if (saved === Theme.LIGHT) return Theme.LIGHT;
		// No stored preference — fall back to OS color scheme on first visit.
		if (globalThis.window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
			return Theme.DARK;
		}
		return Theme.LIGHT;
	} catch {
		return Theme.LIGHT;
	}
}

function persistTheme(theme: Theme): void {
	if (globalThis.window === undefined) return;
	try {
		globalThis.window.localStorage.setItem(LOCAL_STORAGE_THEME_KEY, theme);
	} catch {
		// Ignore (e.g. privacy-mode storage failures).
	}
}

export interface RemoteThemeSettings {
	theme: Theme | null;
	/** Throws if the remote update fails. */
	updateTheme: (theme: Theme) => Promise<unknown>;
}

const RemoteThemeContext = createContext<RemoteThemeSettings | null>(null);

export function useTheme() {
	const { isAuthenticated } = useConvexAuth();
	const remote = useContext(RemoteThemeContext);

	const [localTheme, setLocalTheme] = useState<Theme>(readInitialTheme);

	const saveTheme = useCallback((newTheme: Theme) => {
		setLocalTheme(newTheme);
		persistTheme(newTheme);
	}, []);

	const theme = useMemo<Theme>(() => {
		if (isAuthenticated && remote?.theme) {
			return remote.theme;
		}
		return localTheme;
	}, [isAuthenticated, remote?.theme, localTheme]);

	// Mirror the authoritative remote theme into localStorage so the
	// inline <head> script can render the correct theme on the next reload
	// without waiting for Convex to authenticate and resolve user settings.
	useEffect(() => {
		if (remote?.theme) {
			persistTheme(remote.theme);
		}
	}, [remote?.theme]);

	const setTheme = useCallback(
		async (newTheme: Theme) => {
			if (!isAuthenticated || !remote) {
				saveTheme(newTheme);
				return;
			}
			try {
				await remote.updateTheme(newTheme);
			} catch {
				// Remote sync failed — fall back to a local-only update so the UI
				// still reflects the user's choice on this device.
				saveTheme(newTheme);
			}
		},
		[isAuthenticated, remote, saveTheme]
	);

	const toggleTheme = useCallback(async () => {
		const newTheme = theme === Theme.LIGHT ? Theme.DARK : Theme.LIGHT;
		await setTheme(newTheme);
	}, [theme, setTheme]);

	return { theme, setTheme, toggleTheme };
}

interface ThemeProviderProps {
	readonly children: ReactNode;
	readonly remoteSettings?: RemoteThemeSettings;
}

export function ThemeProvider({ children, remoteSettings }: ThemeProviderProps) {
	return (
		<RemoteThemeContext.Provider value={remoteSettings ?? null}>
			<ThemeApplier>{children}</ThemeApplier>
		</RemoteThemeContext.Provider>
	);
}

function ThemeApplier({ children }: Readonly<{ children: ReactNode }>) {
	const { theme } = useTheme();

	useEffect(() => {
		const root = document.documentElement;
		if (theme === Theme.DARK) {
			root.classList.add(Theme.DARK);
		} else {
			root.classList.remove(Theme.DARK);
		}
	}, [theme]);

	// Enable CSS transitions only after the first paint so the initial
	// inline-script-applied theme doesn't animate on load.
	useEffect(() => {
		const root = document.documentElement;
		const enable = () => root.classList.add("theme-ready");
		const raf = globalThis.requestAnimationFrame?.(enable);
		if (raf === undefined) enable();
		return () => {
			if (raf !== undefined) globalThis.cancelAnimationFrame?.(raf);
		};
	}, []);

	return <>{children}</>;
}
