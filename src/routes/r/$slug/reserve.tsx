import { CustomerReservationForm } from "@/features/reservations";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "convex/_generated/api";

export const Route = createFileRoute("/r/$slug/reserve")({
	component: ReservePage,
});

function ReservePage() {
	const { slug } = Route.useParams();

	const { data: restaurant, isLoading } = useQuery(
		convexQuery(api.restaurants.getBySlug, { slug })
	);

	if (isLoading) {
		return (
			<div className="p-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
				Loading…
			</div>
		);
	}

	if (!restaurant) {
		return (
			<div className="p-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
				Restaurant not found.
			</div>
		);
	}

	return (
		<div className="p-6">
			<CustomerReservationForm restaurantId={restaurant._id} restaurantName={restaurant.name} />
		</div>
	);
}
