import { WelcomeSection } from "@/global/components";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";

export const Route = createFileRoute("/")({ component: App });

function App() {
	const { isAuthenticated, isLoading } = useConvexAuth();

	if (isLoading) return null;

	if (isAuthenticated) {
		return <Navigate to="/admin/restaurants" search={{ manage: undefined }} replace />;
	}

	return (
		<div className="min-h-full flex flex-col bg-background">
			<WelcomeSection />
		</div>
	);
}
