import { ReservationSettingsPanel } from "@/features/reservations";
import { useRestaurant } from "@/features/restaurants";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/admin/reservations/settings")({
	component: SettingsPage,
});

function SettingsPage() {
	const { restaurant } = useRestaurant();

	return (
		<div className="p-6 flex flex-col h-full">
			<div className="mb-6 flex items-start justify-between gap-4">
				<div>
					<Link
						to="/admin/reservations"
						search={{ focus: undefined }}
						className="inline-flex items-center gap-1 text-xs mb-2"
						style={{ color: "var(--text-muted)" }}
					>
						<ArrowLeft size={12} /> Back to reservations
					</Link>
					<h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
						Reservation settings
					</h1>
					<p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
						Default turn time, per-party-size overrides, booking horizon, blackout windows,
						and the global accepting toggle.
					</p>
				</div>
			</div>
			<div className="flex-1 overflow-y-auto">
				{restaurant ? (
					<ReservationSettingsPanel restaurantId={restaurant._id} />
				) : (
					<p className="text-sm" style={{ color: "var(--text-muted)" }}>
						Please set up your restaurant first.
					</p>
				)}
			</div>
		</div>
	);
}
