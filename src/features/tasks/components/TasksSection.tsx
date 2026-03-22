import { WelcomeSection } from "@/global/components/WelcomeSection";
import { useConvexAuth } from "convex/react";
import { Suspense, useEffect, useState } from "react";
import { AuthenticatedTasks } from "./AuthenticatedTasks.tsx";
import { TasksLoadingFallback } from "./TasksLoadingFallback.tsx";

/**
 * Auth-aware tasks section - uses Convex useConvexAuth hook.
 * Only rendered after client hydration (via TasksSection).
 *
 * IMPORTANT: useConvexAuth ensures Convex has validated the auth token,
 * not just that WorkOS has authenticated the user on the client.
 */
function AuthAwareTasksSection() {
	const { isLoading, isAuthenticated } = useConvexAuth();

	if (isLoading) {
		return <TasksLoadingFallback />;
	}

	if (!isAuthenticated) {
		return <WelcomeSection />;
	}

	return (
		<Suspense fallback={<TasksLoadingFallback />}>
			<AuthenticatedTasks />
		</Suspense>
	);
}

/**
 * Tasks section that handles auth state.
 * Only renders auth-dependent content after client hydration
 * to avoid SSR issues with useAuth hook.
 */
export function TasksSection() {
	const [isMounted, setIsMounted] = useState(false);

	// Wait for client hydration before rendering auth-dependent content
	useEffect(() => {
		setIsMounted(true);
	}, []);

	// Show loading state during SSR and initial hydration
	if (!isMounted) {
		return <TasksLoadingFallback />;
	}

	return <AuthAwareTasksSection />;
}
