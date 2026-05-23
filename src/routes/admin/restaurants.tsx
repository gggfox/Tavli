import { AdminRestaurantsList } from "@/features/restaurants";
import { AdminPageLayout } from "@/global/components";
import { RestaurantsKeys } from "@/global/i18n";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";
import { useTranslation } from "react-i18next";

function validateRestaurantsSearch(search: Record<string, unknown>) {
	const raw = search.manage;
	const manage = typeof raw === "string" && raw.length > 0 ? raw : undefined;
	return { manage };
}

export const Route = createFileRoute("/admin/restaurants")({
	validateSearch: validateRestaurantsSearch,
	component: AdminRestaurantsPage,
});

function AdminRestaurantsPage() {
	const { t } = useTranslation();
	const { manage } = Route.useSearch();
	const navigate = useNavigate();
	const manageId = (manage as Id<"restaurants"> | undefined) ?? null;

	const setManageId = (next: Id<"restaurants"> | null) => {
		navigate({
			to: "/admin/restaurants",
			search: { manage: next ?? undefined },
			replace: false,
		});
	};

	// When managing one restaurant's tables, drop the page header and the
	// top action row entirely so the editor takes the full canvas. The
	// expanded card has its own back-arrow + close, which is sufficient
	// chrome.
	if (manageId) {
		return (
			<div className="p-6 flex flex-col h-full">
				<div className="flex-1 min-h-0 overflow-y-auto">
					<AdminRestaurantsList manageId={manageId} onManageChange={setManageId} />
				</div>
			</div>
		);
	}

	return (
		<AdminPageLayout
			title={t(RestaurantsKeys.ADMIN_ALL_TITLE)}
			description={t(RestaurantsKeys.ADMIN_ALL_DESCRIPTION)}
		>
			<AdminRestaurantsList manageId={null} onManageChange={setManageId} />
		</AdminPageLayout>
	);
}
