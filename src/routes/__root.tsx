import { ClerkProvider, useAuth } from "@clerk/tanstack-react-start";
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
import { Menu } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { AuthDebugPanel } from "@/features";
import { useNewReservationListener } from "@/features/reservations";
import { RestaurantAdminProvider, useRestaurant } from "@/features/restaurants";
import { useUserSettings } from "@/features/users/hooks/useUserSettings";
import { ErrorBoundary, NotificationCenter, Sidebar } from "@/global/components";
import { SidebarKeys } from "@/global/i18n";
import { ClientOnlyDevtools, SafeRouterDevtoolsPanel } from "@/global/components/Debug";
import { LOCAL_STORAGE_KEY_SIDEBAR_EXPANDED } from "@/global/components/Sidebar/hooks";
import { config } from "@/global/utils/config";
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
	const { t } = useTranslation();
	useNewReservationListener(restaurant?._id);

	const hideSidebar = pathname === "/" && !isLoading && !isAuthenticated;

	// Below md the sidebar is an off-canvas drawer: on a phone the expanded
	// desktop sidebar consumed over half the viewport and crushed every admin
	// surface into a sliver (TAVLI-4 device audit). Closed on navigation.
	const [mobileNavOpen, setMobileNavOpen] = useState(false);
	useEffect(() => {
		setMobileNavOpen(false);
	}, [pathname]);

	return (
		<div className="h-dvh flex flex-col overflow-hidden bg-background">
			{!hideSidebar && (
				<header className="md:hidden flex items-center gap-3 h-12 shrink-0 px-3 border-b border-border bg-muted">
					<button
						type="button"
						aria-label={t(SidebarKeys.OPEN_NAV)}
						aria-expanded={mobileNavOpen}
						onClick={() => setMobileNavOpen(true)}
						className="p-2 -m-2 rounded-lg text-muted-foreground"
					>
						<Menu size={22} />
					</button>
					<span className="font-semibold text-foreground">{t(SidebarKeys.BRAND_NAME)}</span>
				</header>
			)}
			<div className="flex flex-1 min-h-0 overflow-hidden">
				{!hideSidebar && (
					<>
						{mobileNavOpen && (
							<button
								type="button"
								aria-label={t(SidebarKeys.CLOSE_NAV)}
								onClick={() => setMobileNavOpen(false)}
								className="fixed inset-0 z-40 bg-black/40 md:hidden"
							/>
						)}
						<div
							className={`fixed inset-y-0 left-0 z-50 transition-transform duration-300 md:static md:z-auto md:transition-none ${
								mobileNavOpen ? "translate-x-0" : "-translate-x-full"
							} md:translate-x-0`}
						>
							<Sidebar pathname={pathname} />
						</div>
					</>
				)}
				<main className="flex-1 min-h-0 overflow-auto bg-background">
					<ErrorBoundary>
						<Outlet />
					</ErrorBoundary>
				</main>
			</div>
			<NotificationCenter />
		</div>
	);
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
	const { i18n } = useTranslation();

	return (
		<ClerkProvider>
			<ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
				{/* suppressHydrationWarning: initScript (above) mutates <html> before
				    React hydrates — it adds the `dark` class and the sidebar dataset
				    from localStorage, which the server can't know. React 19 reports
				    the attribute diff as a hydration mismatch; suppressing here is
				    scoped to this element's attributes only, not its subtree. */}
				<html lang={i18n.language} suppressHydrationWarning>
					<head>
						<script dangerouslySetInnerHTML={{ __html: initScript }} />
						<HeadContent />
					</head>
					<body>
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
