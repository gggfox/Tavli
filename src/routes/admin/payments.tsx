import {
	PaymentsDashboard,
	PaymentsDashboardSkeleton,
	validatePaymentsSearch,
} from "@/features/kitchen";
import { useRestaurant } from "@/features/restaurants";
import { AdminPageLayout } from "@/global/components";
import { createFileRoute } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";

export const Route = createFileRoute("/admin/payments")({
	component: PaymentsPage,
	validateSearch: validatePaymentsSearch,
});

function PaymentsPage() {
	const { restaurant, isLoading } = useRestaurant();

	return (
		<AdminPageLayout>
			<PaymentsContent restaurantId={restaurant?._id} isLoading={isLoading} />
		</AdminPageLayout>
	);
}

function PaymentsContent({
	restaurantId,
	isLoading,
}: Readonly<{ restaurantId: Id<"restaurants"> | undefined; isLoading: boolean }>) {
	if (isLoading) return <PaymentsDashboardSkeleton />;
	if (!restaurantId) {
		return (
			<p className="text-sm text-faint-foreground" >
				Please set up your restaurant first.
			</p>
		);
	}
	return <PaymentsDashboard restaurantId={restaurantId} />;
}
