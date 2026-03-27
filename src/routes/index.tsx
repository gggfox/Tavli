import { AdminRestaurantsList } from "@/features/restaurants";
import { WelcomeSection } from "@/global/components";
import { createFileRoute } from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";

export const Route = createFileRoute("/")({ component: App });

function App() {
	const { isAuthenticated, isLoading } = useConvexAuth();

	if (isLoading) return null;

	return (
		<div
			className="h-full flex flex-col overflow-hidden"
			style={{ backgroundColor: "var(--bg-primary)" }}
		>
			{isAuthenticated ? <DashboardContent /> : <WelcomeSection />}
		</div>
	);
}

function DashboardContent() {
	return (
		<div className="p-6 flex flex-col h-full overflow-auto">
			<div className="mb-6">
				<h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
					Dashboard
				</h1>
				<p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
					Manage your restaurants, menus, and orders.
				</p>
			</div>
			<AdminRestaurantsList />
		</div>
	);
}
