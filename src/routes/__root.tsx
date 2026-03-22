import { QueryClient } from "@tanstack/react-query";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { AuthDebugPanel, TasksDebugPanel } from "@/features";
import { ErrorBoundary, Sidebar } from "@/global/components";
import { ClientOnlyDevtools, SafeRouterDevtoolsPanel } from "@/global/components/Debug";
import { ThemeProvider } from "@/global/utils/theme";
import "../global/i18n/config";
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
				title: "TanStack Start Starter",
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

function RootComponent() {
	return (
		<RootDocument>
			<ThemeProvider>
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
			</ThemeProvider>
		</RootDocument>
	);
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
	return (
		<html lang="en">
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
							id: "tasks",
							name: "Tasks",
							render: <TasksDebugPanel />,
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
	);
}
