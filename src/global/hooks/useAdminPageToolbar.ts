import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface AdminPageChromeContextValue {
	readonly registerToolbar: (toolbar: ReactNode) => void;
}

export const AdminPageChromeContext = createContext<AdminPageChromeContextValue | null>(null);

export function useAdminPageChromeState() {
	const [registeredToolbar, setRegisteredToolbar] = useState<ReactNode>(null);
	const value = useMemo(
		() => ({
			registerToolbar: setRegisteredToolbar,
		}),
		[]
	);
	return { registeredToolbar, value };
}

export function useAdminPageToolbar(toolbar: ReactNode) {
	const context = useContext(AdminPageChromeContext);

	useEffect(() => {
		if (!context) return;
		context.registerToolbar(toolbar);
		return () => context.registerToolbar(null);
	}, [context, toolbar]);
}

export function useAdminPageChromeContext() {
	return useContext(AdminPageChromeContext);
}
