import { DialogHeader, Drawer } from "@/global/components";
import {
	ReservationSettingsPanel,
	ReservationsDashboard,
	ReservationsDashboardSkeleton,
	TableLocksManager,
} from "@/features/reservations";
import { useRestaurant } from "@/features/restaurants";
import { createFileRoute } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";
import { Lock, Settings } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/admin/reservations/")({
	component: ReservationsPage,
	validateSearch: (search: Record<string, unknown>) => ({
		focus: typeof search.focus === "string" ? search.focus : undefined,
	}),
});

function ReservationsPage() {
	const { restaurant, isLoading } = useRestaurant();
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [isLocksOpen, setIsLocksOpen] = useState(false);

	const triggerStyle = {
		border: "1px solid var(--border-default)",
		color: "var(--text-secondary)",
	} as const;

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
					<button
						type="button"
						onClick={() => setIsLocksOpen(true)}
						className="flex items-center gap-1 text-sm px-3 py-2 rounded-md"
						style={triggerStyle}
					>
						<Lock size={14} /> Locks
					</button>
					<button
						type="button"
						onClick={() => setIsSettingsOpen(true)}
						className="flex items-center gap-1 text-sm px-3 py-2 rounded-md"
						style={triggerStyle}
					>
						<Settings size={14} /> Settings
					</button>
				</div>
			</div>
			<div className="flex-1 overflow-y-auto">
				<ReservationsContent restaurantId={restaurant?._id} isLoading={isLoading} />
			</div>

			<Drawer
				isOpen={isSettingsOpen}
				onClose={() => setIsSettingsOpen(false)}
				ariaLabel="Reservation settings"
			>
				<DialogHeader
					title="Reservation settings"
					subtitle="Default turn time, per-party-size overrides, booking horizon, blackout windows, and the global accepting toggle."
					onClose={() => setIsSettingsOpen(false)}
					closeAriaLabel="Close drawer"
				/>
				<div className="flex-1 overflow-y-auto px-6 py-4">
					{restaurant ? (
						<ReservationSettingsPanel restaurantId={restaurant._id} />
					) : (
						<p className="text-sm" style={{ color: "var(--text-muted)" }}>
							Please set up your restaurant first.
						</p>
					)}
				</div>
			</Drawer>

			<Drawer
				isOpen={isLocksOpen}
				onClose={() => setIsLocksOpen(false)}
				ariaLabel="Table locks"
			>
				<DialogHeader
					title="Table locks"
					subtitle="Take a table out of service for a window. Locked tables are hidden from public availability and the staff table picker for that window."
					onClose={() => setIsLocksOpen(false)}
					closeAriaLabel="Close drawer"
				/>
				<div className="flex-1 overflow-y-auto px-6 py-4">
					{restaurant ? (
						<TableLocksManager restaurantId={restaurant._id} />
					) : (
						<p className="text-sm" style={{ color: "var(--text-muted)" }}>
							Please set up your restaurant first.
						</p>
					)}
				</div>
			</Drawer>
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
