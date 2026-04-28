import { ReservationsDashboard, ReservationsDashboardSkeleton } from "@/features/reservations";
import { useRestaurant } from "@/features/restaurants";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";
import { Lock, Settings } from "lucide-react";

export const Route = createFileRoute("/admin/reservations/")({
	component: ReservationsPage,
	validateSearch: (search: Record<string, unknown>) => ({
		focus: typeof search.focus === "string" ? (search.focus as string) : undefined,
	}),
});

function ReservationsPage() {
	const { restaurant, isLoading } = useRestaurant();

	return (
		<div className="p-6 flex flex-col h-full">
			<div className="mb-6 flex items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
						Reservations
					</h1>
					<p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
						Confirm, seat, and review reservations. Updates in real time.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Link
						to="/admin/reservations/locks"
						className="flex items-center gap-1 text-sm px-3 py-2 rounded-md"
						style={{
							border: "1px solid var(--border-default)",
							color: "var(--text-secondary)",
						}}
					>
						<Lock size={14} /> Locks
					</Link>
					<Link
						to="/admin/reservations/settings"
						className="flex items-center gap-1 text-sm px-3 py-2 rounded-md"
						style={{
							border: "1px solid var(--border-default)",
							color: "var(--text-secondary)",
						}}
					>
						<Settings size={14} /> Settings
					</Link>
				</div>
			</div>
			<div className="flex-1 overflow-y-auto">
				<ReservationsContent restaurantId={restaurant?._id} isLoading={isLoading} />
			</div>
		</div>
	);
}

function ReservationsContent({
	restaurantId,
	isLoading,
}: Readonly<{ restaurantId: Id<"restaurants"> | undefined; isLoading: boolean }>) {
	if (isLoading) return <ReservationsDashboardSkeleton />;
	if (!restaurantId) {
		return (
			<p className="text-sm" style={{ color: "var(--text-muted)" }}>
				Please set up your restaurant first.
			</p>
		);
	}
	return <ReservationsDashboard restaurantId={restaurantId} />;
}
