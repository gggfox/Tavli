import { AdminRestaurantsList } from "@/features/restaurants";
import { AdminPageLayout } from "@/global/components";
import { RestaurantsKeys } from "@/global/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/restaurants")({
	component: AdminRestaurantsPage,
});

function AdminRestaurantsPage() {
	const { t } = useTranslation();
	return (
		<AdminPageLayout
			title={t(RestaurantsKeys.ADMIN_ALL_TITLE)}
			description={t(RestaurantsKeys.ADMIN_ALL_DESCRIPTION)}
		>
			<AdminRestaurantsList />
		</AdminPageLayout>
	);
}
