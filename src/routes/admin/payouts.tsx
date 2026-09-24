import { FinancesTabs, PayoutsDashboard, PayoutsDashboardSkeleton } from "@/features/payouts";
import { useRestaurant } from "@/features/restaurants";
import { AdminPageLayout } from "@/global/components";
import { PayoutsKeys } from "@/global/i18n";
import { createFileRoute } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";
import { useTranslation } from "react-i18next";

/**
 * `/admin/payouts` — the restaurant's payouts (TAVLI-103).
 *
 * Thin like `/admin/payments`, and gated the same way: the authorization that
 * matters is on the backend (`api.payouts.listByRestaurant` and
 * `.getHeldTotal` both require `requireRestaurantManagerOrAbove`), so this route
 * only resolves the current Restaurant and hands it over. It has no sidebar
 * entry of its own: it is the second tab behind Finances, beside Payments; an
 * employee who types the URL gets a refusal from Convex, not a page.
 */
export const Route = createFileRoute("/admin/payouts")({
	component: PayoutsPage,
});

function PayoutsPage() {
	const { restaurant, isLoading } = useRestaurant();

	return (
		<AdminPageLayout breadcrumb={<FinancesTabs />}>
			<PayoutsContent restaurantId={restaurant?._id} isLoading={isLoading} />
		</AdminPageLayout>
	);
}

function PayoutsContent({
	restaurantId,
	isLoading,
}: Readonly<{ restaurantId: Id<"restaurants"> | undefined; isLoading: boolean }>) {
	const { t } = useTranslation();

	if (isLoading) return <PayoutsDashboardSkeleton />;
	// Through a key, not the bare English the older admin routes still carry:
	// the whole point of this page is a restaurant reading about its own money
	// in its own language, and the empty state is the first thing a new one
	// sees.
	if (!restaurantId) {
		return <p className="text-sm text-faint-foreground">{t(PayoutsKeys.NO_RESTAURANT)}</p>;
	}
	return <PayoutsDashboard restaurantId={restaurantId} />;
}
