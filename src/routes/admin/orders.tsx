import { ExportButton, useCanExport } from "@/features/exports";
import { OrderDashboard, OrderDashboardSkeleton } from "@/features/kitchen";
import { useRestaurant } from "@/features/restaurants";
import { OrdersKeys } from "@/global/i18n/keys/orders";
import { createFileRoute } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/orders")({
	component: OrdersPage,
});

function OrdersPage() {
	const { t } = useTranslation();
	const { restaurant, isLoading } = useRestaurant();
	const { canExport } = useCanExport(
		restaurant?._id,
		restaurant?.organizationId,
		restaurant?.ownerId
	);

	return (
		<div className="p-6 flex flex-col h-full">
			<div className="mb-6 flex items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold text-foreground">{t(OrdersKeys.PAGE_TITLE)}</h1>
					<p className="mt-2 text-sm text-muted-foreground">{t(OrdersKeys.PAGE_DESCRIPTION)}</p>
				</div>
				{restaurant && canExport ? (
					<ExportButton restaurantId={restaurant._id} kind="orders" />
				) : null}
			</div>
			<div className="flex-1 min-h-0 overflow-y-auto">
				<OrdersContent restaurantId={restaurant?._id} isLoading={isLoading} />
			</div>
		</div>
	);
}

function OrdersContent({
	restaurantId,
	isLoading,
}: Readonly<{ restaurantId: Id<"restaurants"> | undefined; isLoading: boolean }>) {
	if (isLoading) return <OrderDashboardSkeleton />;
	if (!restaurantId) {
		return <p className="text-sm text-faint-foreground">Please set up your restaurant first.</p>;
	}
	return <OrderDashboard restaurantId={restaurantId} />;
}
