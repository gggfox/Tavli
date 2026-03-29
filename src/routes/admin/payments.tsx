import { PaymentsDashboard } from "@/features/kitchen";
import { useRestaurant } from "@/features/restaurants";
import { AdminPageLayout, LoadingState } from "@/global/components";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/payments")({
	component: PaymentsPage,
});

function PaymentsPage() {
	const { restaurant, isLoading } = useRestaurant();

	if (isLoading) {
		return (
			<div className="p-6">
				<LoadingState />
			</div>
		);
	}

	if (!restaurant) {
		return (
			<div className="p-6">
				<p className="text-sm" style={{ color: "var(--text-muted)" }}>
					Please set up your restaurant first.
				</p>
			</div>
		);
	}

	return (
		<AdminPageLayout title="Payments" description="View revenue and payment history.">
			<PaymentsDashboard restaurantId={restaurant._id} />
		</AdminPageLayout>
	);
}
