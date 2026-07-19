import { ClerkProvider, useAuth, useUser } from "@clerk/tanstack-react-start";
import { PostHogProvider, usePostHog } from "posthog-js/react";
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
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { AuthDebugPanel } from "@/features";
import { useNewReservationListener } from "@/features/reservations";
import { RestaurantAdminProvider, useRestaurant } from "@/features/restaurants";
import { useUserSettings } from "@/features/users/hooks/useUserSettings";
import { ErrorBoundary, NotificationCenter, Sidebar } from "@/global/components";
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

function PostHogIdentify() {
	const { user, isLoaded } = useUser();
	const posthog = usePostHog();

	useEffect(() => {
		if (!isLoaded) return;
		if (user) {
			posthog.identify(user.id, {
				email: user.primaryEmailAddress?.emailAddress,
				name: user.fullName ?? undefined,
			});
		}
	}, [isLoaded, user, posthog]);

	return null;
}

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
	useNewReservationListener(restaurant?._id);

	const hideSidebar = pathname === "/" && !isLoading && !isAuthenticated;

	return (
		<div className="h-dvh flex overflow-hidden bg-background">
			{!hideSidebar && <Sidebar pathname={pathname} />}
			<main className="flex-1 min-h-0 overflow-auto bg-background">
				<ErrorBoundary>
					<Outlet />
				</ErrorBoundary>
			</main>
			<NotificationCenter />
		</div>
	);
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
	const { i18n } = useTranslation();

	return (
		<ClerkProvider>
			<ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
				<html lang={i18n.language}>
					<head>
						<script dangerouslySetInnerHTML={{ __html: initScript }} />
						<HeadContent />
					</head>
					<body>
						<PostHogProvider
							apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN!}
							options={{
								api_host: "/ingest",
								ui_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST || "https://us.posthog.com",
								defaults: "2025-05-24",
								capture_exceptions: true,
								debug: import.meta.env.DEV,
							}}
						>
							<PostHogIdentify />
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
						</PostHogProvider>
						<Scripts />
					</body>
				</html>
			</ConvexProviderWithClerk>
		</ClerkProvider>
	);
}
