import { CustomerReservationForm } from "@/features/reservations";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CustomerKeys } from "@/global/i18n";
import { useTranslation } from "react-i18next";
import { api } from "convex/_generated/api";

export const Route = createFileRoute("/r/$slug/reserve")({
	component: ReservePage,
});

function ReservePage() {
	const { t } = useTranslation();
	const { slug } = Route.useParams();

	const { data: restaurant, isLoading } = useQuery(
		convexQuery(api.restaurants.getBySlug, { slug })
	);
	// Both switches, in one anonymous-safe read (TAVLI-100). Hiding the Reserve
	// tab stops navigation and nothing else — this page is reachable by URL, by
	// a bookmark, and by a link somebody shared last week.
	const { data: bookable, isLoading: bookableLoading } = useQuery(
		convexQuery(
			api.reservations.isBookableByDiners,
			restaurant ? { restaurantId: restaurant._id } : "skip"
		)
	);

	if (isLoading || (restaurant && bookableLoading)) {
		return <div className="p-6 text-center text-sm text-faint-foreground">Loading…</div>;
	}

	if (!restaurant) {
		return (
			<div className="p-6 text-center text-sm text-faint-foreground">Restaurant not found.</div>
		);
	}

	if (!bookable) {
		// Deliberately does not say whether it was the platform or the
		// restaurant. A diner needs to know they cannot book here today; which
		// switch produced that is not their business, and one of the two
		// answers is a fact about Tavli's rollout rather than about dinner.
		return (
			<div className="p-6 text-center text-sm text-faint-foreground">
				{t(CustomerKeys.RESERVATIONS_UNAVAILABLE)}
			</div>
		);
	}

	return (
		<div className="p-6">
			<CustomerReservationForm restaurantId={restaurant._id} restaurantName={restaurant.name} />
		</div>
	);
}
