import { restoreSession, useSessionStore } from "@/features/ordering";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import { api } from "convex/_generated/api";
import { useEffect, useState } from "react";

function getSessionErrorMessage(err: unknown): string {
	let raw = "";
	if (err instanceof Error) raw = err.message;
	else if (typeof err === "string") raw = err;

	if (raw.includes("Restaurant not found")) {
		return "This restaurant was not found or is currently unavailable. Please check the link.";
	}
	return "Something went wrong. Please try refreshing the page.";
}

export const Route = createFileRoute("/r/$slug")({
	component: CustomerLayout,
});

function CustomerLayout() {
	const { slug } = Route.useParams();
	const { sessionId, setSession } = useSessionStore();
	const [error, setError] = useState<string | null>(null);

	const createSession = useMutation({
		mutationFn: useConvexMutation(api.sessions.create),
	});

	useEffect(() => {
		if (sessionId) return;

		const restored = restoreSession();
		if (restored) {
			setSession(restored);
			return;
		}

		createSession
			.mutateAsync({
				restaurantSlug: slug,
			})
			.then((result) => {
				setSession({
					sessionId: result.sessionId,
					restaurantId: result.restaurantId,
				});
			})
			.catch((err: unknown) => {
				setError(getSessionErrorMessage(err));
			});
	}, [slug]);

	if (error) {
		return (
			<div className="flex-1 flex items-center justify-center p-6">
				<div className="text-center max-w-sm">
					<h1 className="text-xl font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
						Oops!
					</h1>
					<p className="text-sm" style={{ color: "var(--text-secondary)" }}>
						{error}
					</p>
				</div>
			</div>
		);
	}

	if (!sessionId) {
		return (
			<div className="flex-1 flex items-center justify-center">
				<p style={{ color: "var(--text-muted)" }}>Loading...</p>
			</div>
		);
	}

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			<header
				className="px-4 py-3 flex items-center justify-between shrink-0"
				style={{
					borderBottom: "1px solid var(--border-default)",
					backgroundColor: "var(--bg-secondary)",
				}}
			>
				<span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
					Menu
				</span>
			</header>
			<div className="flex-1 overflow-hidden">
				<Outlet />
			</div>
		</div>
	);
}
