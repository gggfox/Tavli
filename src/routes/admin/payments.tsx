import { ExportButton, useCanExport } from "@/features/exports";
import {
	PaymentsDashboard,
	PaymentsDashboardSkeleton,
	validatePaymentsSearch,
} from "@/features/kitchen";
import { FinancesTabs } from "@/features/payouts";
import { useRestaurant } from "@/features/restaurants";
import { AdminPageLayout } from "@/global/components";
import { AdminAccessKeys } from "@/global/i18n";
import { createFileRoute } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/payments")({
	component: PaymentsPage,
	validateSearch: validatePaymentsSearch,
});

function PaymentsPage() {
	const { restaurant, isLoading } = useRestaurant();
	const { canExport } = useCanExport(
		restaurant?._id,
		restaurant?.organizationId,
		restaurant?.ownerId
	);

	return (
		<AdminPageLayout
			breadcrumb={<FinancesTabs />}
			actions={
				restaurant && canExport ? (
					<ExportButton restaurantId={restaurant._id} kind="payments" />
				) : undefined
			}
		>
			<PaymentsContent restaurantId={restaurant?._id} isLoading={isLoading} />
		</AdminPageLayout>
	);
}

function PaymentsContent({
	restaurantId,
	isLoading,
}: Readonly<{ restaurantId: Id<"restaurants"> | undefined; isLoading: boolean }>) {
	const { t } = useTranslation();
	if (isLoading) return <PaymentsDashboardSkeleton />;
	if (!restaurantId) {
		return (
			<p className="text-sm text-faint-foreground">{t(AdminAccessKeys.SETUP_RESTAURANT_FIRST)}</p>
		);
	}
	return <PaymentsDashboard restaurantId={restaurantId} />;
}
