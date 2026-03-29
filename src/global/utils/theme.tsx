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
const LOCAL_STORAGE_THEME_KEY = "fierro-viejo-theme";

export interface RemoteThemeSettings {
	theme: Theme | null;
	updateTheme: (theme: Theme) => Promise<{ success: boolean; error?: unknown }>;
}

const RemoteThemeContext = createContext<RemoteThemeSettings | null>(null);

export function useTheme() {
	const { isAuthenticated } = useConvexAuth();
	const remote = useContext(RemoteThemeContext);

	const [localTheme, setLocalTheme] = useState<Theme>(() => {
		if (globalThis.window === undefined) return Theme.LIGHT;
		const saved = globalThis.window.localStorage.getItem(LOCAL_STORAGE_THEME_KEY);
		return saved === Theme.DARK ? Theme.DARK : Theme.LIGHT;
	});

	const saveTheme = useCallback((newTheme: Theme) => {
		setLocalTheme(newTheme);
		if (globalThis.window !== undefined) {
			globalThis.window.localStorage.setItem(LOCAL_STORAGE_THEME_KEY, newTheme);
		}
	}, []);

	const theme = useMemo<Theme>(() => {
		if (isAuthenticated && remote?.theme) {
			return remote.theme;
		}
		return localTheme;
	}, [isAuthenticated, remote?.theme, localTheme]);

	const setTheme = useCallback(
		async (newTheme: Theme) => {
			if (!isAuthenticated || !remote) {
				saveTheme(newTheme);
				return;
			}
			const result = await remote.updateTheme(newTheme);
			if (!result.success) {
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

	return <>{children}</>;
}
