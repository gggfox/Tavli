import { AdminRestaurantsList } from "@/features/restaurants";
import { AdminPageLayout } from "@/global/components";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";

/**
 * `?manage=<id>` opens the tables canvas, `?settings=<id>` the settings
 * canvas. They are mutually exclusive -- both take the whole page, so one
 * always clears the other. `settings` wins if a URL somehow carries both.
 */
function validateRestaurantsSearch(search: Record<string, unknown>) {
	const rawManage = search.manage;
	const rawSettings = search.settings;
	const manage = typeof rawManage === "string" && rawManage.length > 0 ? rawManage : undefined;
	const settings =
		typeof rawSettings === "string" && rawSettings.length > 0 ? rawSettings : undefined;
	if (settings) return { manage: undefined, settings };
	return { manage, settings: undefined };
}

export const Route = createFileRoute("/admin/restaurants")({
	validateSearch: validateRestaurantsSearch,
	component: AdminRestaurantsPage,
});

function AdminRestaurantsPage() {
	const { manage, settings } = Route.useSearch();
	const navigate = useNavigate();
	const manageId = (manage as Id<"restaurants"> | undefined) ?? null;
	const settingsId = (settings as Id<"restaurants"> | undefined) ?? null;

	const setManageId = (next: Id<"restaurants"> | null) => {
		navigate({
			to: "/admin/restaurants",
			search: { manage: next ?? undefined, settings: undefined },
			replace: false,
		});
	};

	const setSettingsId = (next: Id<"restaurants"> | null) => {
		navigate({
			to: "/admin/restaurants",
			search: { settings: next ?? undefined, manage: undefined },
			replace: false,
		});
	};

	// When managing one restaurant's tables or editing its settings, drop the
	// page header and the top action row entirely so the editor takes the full
	// canvas. Each canvas has its own back-arrow + close, which is sufficient
	// chrome.
	if (manageId || settingsId) {
		return (
			<div className="p-6 flex flex-col h-full">
				<div className="flex-1 min-h-0 overflow-y-auto">
					<AdminRestaurantsList
						manageId={manageId}
						onManageChange={setManageId}
						settingsId={settingsId}
						onSettingsChange={setSettingsId}
					/>
				</div>
			</div>
		);
	}

	return (
		<AdminPageLayout>
			<AdminRestaurantsList
				manageId={null}
				onManageChange={setManageId}
				settingsId={null}
				onSettingsChange={setSettingsId}
			/>
		</AdminPageLayout>
	);
}
