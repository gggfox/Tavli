import { ClerkProvider, useAuth, useUser } from "@clerk/tanstack-react-start";
import { QueryClient } from "@tanstack/react-query";
import {
	HeadContent,
	Outlet,
	Scripts,
	createRootRouteWithContext,
	useRouterState,
} from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useEffect, useRef, type ReactNode } from "react";

import { AuthDebugPanel } from "@/features";
import { useNewReservationListener } from "@/features/reservations";
import { RestaurantAdminProvider, useRestaurant } from "@/features/restaurants";
import { useUserSettings } from "@/features/users/hooks/useUserSettings";
import { ErrorBoundary, MobileTopBar, NotificationCenter, Sidebar } from "@/global/components";
import { ClientOnlyDevtools, SafeRouterDevtoolsPanel } from "@/global/components/Debug";
import { LOCAL_STORAGE_KEY_SIDEBAR_EXPANDED } from "@/global/components/Sidebar/hooks";
import { i18n, normalizeLanguage, resolveLanguage } from "@/global/i18n";
import { config } from "@/global/utils/config";
import { identifyUser, initTelemetry, resetUser } from "@/global/utils/telemetry";
import {
	LOCAL_STORAGE_THEME_KEY,
	type RemoteThemeSettings,
	ThemeProvider,
} from "@/global/utils/theme";
import "../global/i18n/config";
import { convexClient } from "../convexClient";
import appCss from "../styles.css?url";

// Inline script that runs synchronously in <head> before any paint.
// Sets the `dark` class on <html> based on localStorage (and falls back to
// the OS color scheme on first visit) to prevent a light-mode flash on reload.
// Also mirrors the saved sidebar-expanded preference into a
// `data-sidebar-expanded` attribute so the sidebar lands at its final width
// before React hydrates (no LoadingSkeleton flash).
//
// Migrates the pre-rename `fierro-viejo-theme` key into the canonical
// `tavli-theme` key on first visit, so users who saved a preference under
// the old name don't lose it.
const initScript = `(function(){try{var k=${JSON.stringify(LOCAL_STORAGE_THEME_KEY)};var t=localStorage.getItem(k);if(t===null){var legacy=localStorage.getItem('fierro-viejo-theme');if(legacy!==null){localStorage.setItem(k,legacy);localStorage.removeItem('fierro-viejo-theme');t=legacy;}}var d=t==='dark'||(!t&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');var sk=${JSON.stringify(LOCAL_STORAGE_KEY_SIDEBAR_EXPANDED)};var st=localStorage.getItem(sk);if(st==='false')document.documentElement.dataset.sidebarExpanded='false';}catch(e){}})();`;

// At module scope, before any route renders: the error boundaries below report
// through telemetry, so it has to be live before they can catch anything. A
// no-op on the server and without a project token.
initTelemetry();

function RootNotFound() {
	return (
		<div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 p-8 text-center">
			<h1 className="text-lg font-medium text-foreground">Page not found</h1>
			<p className="max-w-sm text-sm text-muted-foreground">
				The URL may be mistyped, or the page may have been removed.
			</p>
		</div>
	);
}

export const Route = createRootRouteWithContext<{
	queryClient: QueryClient;
}>()({
	notFoundComponent: RootNotFound,
	/**
	 * Resolve the request's language before anything renders, so the SSR pass
	 * and the first client render agree. Without this the server always fell
	 * back to `en` (the i18next detector only looks at localStorage/navigator)
	 * while a returning Spanish user hydrated to `es` — a guaranteed
	 * `<html lang>` + copy mismatch on first paint.
	 *
	 * Note: `i18n` is a module singleton, so on the server this mutates state
	 * shared by concurrent requests. Renders are synchronous with respect to
	 * this assignment, but if we ever add awaits between here and render, this
	 * needs to move to a per-request instance.
	 */
	beforeLoad: async ({ location }) => {
		const language = await resolveLanguage(location.pathname);
		if (normalizeLanguage(i18n.language) !== language) {
			await i18n.changeLanguage(language);
		}
		return { language };
	},
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1, viewport-fit=cover",
			},
			{
				name: "color-scheme",
				content: "light dark",
			},
			{
				title: "Tavli",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),

	component: RootComponent,
});

function useRemoteThemeSettings(): RemoteThemeSettings {
	const { settings, theme, updateTheme } = useUserSettings();
	return {
		theme: settings ? theme : null,
		updateTheme,
	};
}

function RootComponent() {
	return (
		<RootDocument>
			<RootLayout />
		</RootDocument>
	);
}

function RootLayout() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const isCustomerRoute = pathname.startsWith("/r/");
	const remoteSettings = useRemoteThemeSettings();

	return (
		<ThemeProvider remoteSettings={remoteSettings}>
			{isCustomerRoute ? (
				<div className="h-dvh flex flex-col overflow-hidden bg-background">
					<ErrorBoundary>
						<Outlet />
					</ErrorBoundary>
				</div>
			) : (
				<RestaurantAdminProvider>
					<StaffLayout />
				</RestaurantAdminProvider>
			)}
		</ThemeProvider>
	);
}

function StaffLayout() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const { restaurant } = useRestaurant();
	const { isAuthenticated, isLoading } = useConvexAuth();
	useNewReservationListener(restaurant?._id);

	const hideSidebar = pathname === "/" && !isLoading && !isAuthenticated;

	return (
		// Phones stack a top bar over the page (the sidebar is a drawer there);
		// from md up the sidebar sits beside it.
		<div className="h-dvh flex flex-col md:flex-row overflow-hidden bg-background">
			{!hideSidebar && <MobileTopBar />}
			{!hideSidebar && <Sidebar pathname={pathname} />}
			<main className="flex-1 min-h-0 min-w-0 overflow-auto bg-background">
				<ErrorBoundary>
					<Outlet />
				</ErrorBoundary>
			</main>
			<NotificationCenter />
		</div>
	);
}

/**
 * Ties telemetry to the signed-in Clerk user — id only, per ADR-006 — and
 * forgets them on sign-out, so a shared staff tablet never attributes the next
 * person's session to whoever just left. `SettingsModal` also resets before it
 * calls Clerk, because a sign-out that navigates away unmounts this component
 * before the effect can see the transition.
 */
function TelemetryIdentity() {
	const { user, isLoaded } = useUser();
	const userId = user?.id ?? null;
	const wasSignedIn = useRef(false);

	useEffect(() => {
		if (!isLoaded) return;
		if (userId) {
			identifyUser(userId);
			wasSignedIn.current = true;
		} else if (wasSignedIn.current) {
			resetUser();
			wasSignedIn.current = false;
		}
	}, [isLoaded, userId]);

	return null;
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
	// Router context, not `i18n.language`: the context value is computed in
	// `beforeLoad` and is therefore identical on the server and on hydration.
	const { language } = Route.useRouteContext();

	return (
		<ClerkProvider>
			<ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
				<html lang={language}>
					<head>
						<script dangerouslySetInnerHTML={{ __html: initScript }} />
						<HeadContent />
					</head>
					<body>
						<TelemetryIdentity />
						{children}
						{config.isDev ? (
							<ClientOnlyDevtools
								config={{
									position: "bottom-right",
								}}
								plugins={[
									{
										id: "auth",
										name: "Auth",
										render: <AuthDebugPanel />,
									},
									{
										id: "router",
										name: "Router",
										render: <SafeRouterDevtoolsPanel />,
									},
								]}
							/>
						) : null}
						<Scripts />
					</body>
				</html>
			</ConvexProviderWithClerk>
		</ClerkProvider>
	);
}
