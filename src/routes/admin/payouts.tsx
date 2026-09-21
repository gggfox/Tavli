import { PayoutsDashboard, PayoutsDashboardSkeleton } from "@/features/payouts";
import { useRestaurant } from "@/features/restaurants";
import { AdminPageLayout } from "@/global/components";
import { createFileRoute } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";

/**
 * `/admin/payouts` — the restaurant's payouts (TAVLI-103).
 *
 * Thin like `/admin/payments`, and gated the same way: the authorization that
 * matters is on the backend (`api.payouts.listByRestaurant` and
 * `.getHeldTotal` both require `requireRestaurantManagerOrAbove`), so this route
 * only resolves the current Restaurant and hands it over. The sidebar entry sits
 * beside Payments in the staff group; an employee who types the URL gets a
 * refusal from Convex, not a page.
 */
export const Route = createFileRoute("/admin/payouts")({
	component: PayoutsPage,
});

function PayoutsPage() {
	const { restaurant, isLoading } = useRestaurant();

	return (
		<AdminPageLayout>
			<PayoutsContent restaurantId={restaurant?._id} isLoading={isLoading} />
		</AdminPageLayout>
	);
}

function PayoutsContent({
	restaurantId,
	isLoading,
}: Readonly<{ restaurantId: Id<"restaurants"> | undefined; isLoading: boolean }>) {
	if (isLoading) return <PayoutsDashboardSkeleton />;
	if (!restaurantId) {
		return <p className="text-sm text-faint-foreground">Please set up your restaurant first.</p>;
	}
	return <PayoutsDashboard restaurantId={restaurantId} />;
}
