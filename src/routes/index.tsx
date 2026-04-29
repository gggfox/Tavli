import { WelcomeSection } from "@/global/components";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";

export const Route = createFileRoute("/")({ component: App });

function App() {
	const { isAuthenticated, isLoading } = useConvexAuth();

	if (isLoading) return null;

	if (isAuthenticated) {
		return <Navigate to="/admin/restaurants" replace />;
	}

	return (
		<div
			className="h-full flex flex-col overflow-hidden"
			style={{ backgroundColor: "var(--bg-primary)" }}
		>
			<WelcomeSection />
		</div>
	);
}
