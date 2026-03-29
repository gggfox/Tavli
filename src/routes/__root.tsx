import { ClerkProvider, useAuth } from "@clerk/tanstack-react-start";
import { QueryClient } from "@tanstack/react-query";
import {
	HeadContent,
	Outlet,
	Scripts,
	createRootRouteWithContext,
	useRouterState,
} from "@tanstack/react-router";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { AuthDebugPanel } from "@/features";
import { useUserSettings } from "@/features/users/hooks/useUserSettings";
import { ErrorBoundary, Sidebar } from "@/global/components";
import { ClientOnlyDevtools, SafeRouterDevtoolsPanel } from "@/global/components/Debug";
import { type RemoteThemeSettings, ThemeProvider } from "@/global/utils/theme";
import "../global/i18n/config";
import { convexClient } from "../router";
import appCss from "../styles.css?url";

export const Route = createRootRouteWithContext<{
	queryClient: QueryClient;
}>()({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
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
				<div
					className="h-screen flex flex-col overflow-hidden"
					style={{ backgroundColor: "var(--bg-primary)" }}
				>
					<ErrorBoundary>
						<Outlet />
					</ErrorBoundary>
				</div>
			) : (
				<div
					className="h-screen flex overflow-hidden"
					style={{ backgroundColor: "var(--bg-primary)" }}
				>
					<Sidebar />
					<main className="flex-1 overflow-auto" style={{ backgroundColor: "var(--bg-primary)" }}>
						<ErrorBoundary>
							<Outlet />
						</ErrorBoundary>
					</main>
				</div>
			)}
		</ThemeProvider>
	);
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
	const { i18n } = useTranslation();

	return (
		<ClerkProvider>
			<ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
				<html lang={i18n.language}>
					<head>
						<HeadContent />
					</head>
					<body>
						{children}
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
						<Scripts />
					</body>
				</html>
			</ConvexProviderWithClerk>
		</ClerkProvider>
	);
}
