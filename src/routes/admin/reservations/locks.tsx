import { TableLocksManager } from "@/features/reservations";
import { useRestaurant } from "@/features/restaurants";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/admin/reservations/locks")({
	component: LocksPage,
});

function LocksPage() {
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
						Table locks
					</h1>
					<p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
						Take a table out of service for a window. Locked tables are hidden from public
						availability and the staff table picker for that window.
					</p>
				</div>
			</div>
			<div className="flex-1 overflow-y-auto">
				{restaurant ? (
					<TableLocksManager restaurantId={restaurant._id} />
				) : (
					<p className="text-sm" style={{ color: "var(--text-muted)" }}>
						Please set up your restaurant first.
					</p>
				)}
			</div>
		</div>
	);
}
