import { ExportButton, useCanExport } from "@/features/exports";
import { OrderDashboard, OrderDashboardSkeleton } from "@/features/kitchen";
import { useRestaurant } from "@/features/restaurants";
import { AdminPageLayout } from "@/global/components";
import { AdminAccessKeys } from "@/global/i18n";
import { createFileRoute } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/orders")({
	component: OrdersPage,
});

function OrdersPage() {
	const { restaurant, isLoading } = useRestaurant();
	const { canExport } = useCanExport(
		restaurant?._id,
		restaurant?.organizationId,
		restaurant?.ownerId
	);

	return (
		<AdminPageLayout
			actions={
				restaurant && canExport ? (
					<ExportButton restaurantId={restaurant._id} kind="orders" />
				) : undefined
			}
		>
			<OrdersContent restaurantId={restaurant?._id} isLoading={isLoading} />
		</AdminPageLayout>
	);
}

function OrdersContent({
	restaurantId,
	isLoading,
}: Readonly<{ restaurantId: Id<"restaurants"> | undefined; isLoading: boolean }>) {
	const { t } = useTranslation();
	if (isLoading) return <OrderDashboardSkeleton />;
	if (!restaurantId) {
		return (
			<p className="text-sm text-faint-foreground">{t(AdminAccessKeys.SETUP_RESTAURANT_FIRST)}</p>
		);
	}
	return <OrderDashboard restaurantId={restaurantId} />;
}
