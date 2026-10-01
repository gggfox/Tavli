import { CustomerReservationForm } from "@/features/reservations";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
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
		return (
			<div className="p-6 text-center text-sm text-faint-foreground">{t(CustomerKeys.LOADING)}</div>
		);
	}

	if (!restaurant) {
		return (
			<div className="p-6 text-center text-sm text-faint-foreground">
				{t(CustomerKeys.NOT_FOUND_TITLE)}
			</div>
		);
	}

	if (!bookable) {
		// Deliberately does not say whether it was the platform or the
		// restaurant. A diner needs to know they cannot book here today; which
		// switch produced that is not their business, and one of the two
		// answers is a fact about Tavli's rollout rather than about dinner.
		// The menu is the one thing they can still do here, so offer it rather
		// than leaving a sentence with nowhere to go.
		return (
			<div className="p-6 flex flex-col items-center gap-4 text-center">
				<p className="text-sm text-muted-foreground">{t(CustomerKeys.RESERVATIONS_UNAVAILABLE)}</p>
				<Link
					to="/r/$slug/menu"
					params={{ slug }}
					className="px-6 py-2.5 font-medium rounded-lg text-center hover-btn-secondary"
				>
					{t(CustomerKeys.MENU)}
				</Link>
			</div>
		);
	}

	// The customer layout clips its outlet (`overflow-hidden`), so the page owns
	// its scroll: on a phone the form is taller than the screen, and without
	// this the submit button sat below the fold, unreachable.
	return (
		<div className="h-full overflow-y-auto overscroll-contain p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
			<CustomerReservationForm restaurantId={restaurant._id} restaurantName={restaurant.name} />
		</div>
	);
}
