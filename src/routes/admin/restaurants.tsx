import { AdminRestaurantsList } from "@/features/restaurants";
import {
	isRestaurantSettingsNavId,
	type RestaurantSettingsNavId,
} from "@/features/restaurants/constants";
import { AdminPageLayout } from "@/global/components";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";

/**
 * `?manage=<id>` opens the tables canvas, `?settings=<id>` the settings
 * canvas. They are mutually exclusive -- both take the whole page, so one
 * always clears the other. `settings` wins if a URL somehow carries both.
 * `section` only means something inside the settings canvas.
 */
function validateRestaurantsSearch(search: Record<string, unknown>): {
	manage?: string;
	settings?: string;
	section?: RestaurantSettingsNavId;
} {
	const rawManage = search.manage;
	const rawSettings = search.settings;
	const manage = typeof rawManage === "string" && rawManage.length > 0 ? rawManage : undefined;
	const settings =
		typeof rawSettings === "string" && rawSettings.length > 0 ? rawSettings : undefined;
	if (settings) {
		const section = isRestaurantSettingsNavId(search.section) ? search.section : undefined;
		return { manage: undefined, settings, section };
	}
	return { manage, settings: undefined, section: undefined };
}

export const Route = createFileRoute("/admin/restaurants")({
	validateSearch: validateRestaurantsSearch,
	component: AdminRestaurantsPage,
});

function AdminRestaurantsPage() {
	const { manage, settings, section } = Route.useSearch();
	const navigate = useNavigate();
	const manageId = (manage as Id<"restaurants"> | undefined) ?? null;
	const settingsId = (settings as Id<"restaurants"> | undefined) ?? null;

	const setManageId = (next: Id<"restaurants"> | null) => {
		navigate({
			to: "/admin/restaurants",
			search: { manage: next ?? undefined, settings: undefined, section: undefined },
			replace: false,
		});
	};

	const setSettingsId = (next: Id<"restaurants"> | null) => {
		navigate({
			to: "/admin/restaurants",
			search: { settings: next ?? undefined, manage: undefined, section: undefined },
			replace: false,
		});
	};

	/**
	 * Picking a section pushes history (phone back returns to the list);
	 * the desktop scrollspy replaces, so scrolling doesn't fill history.
	 */
	const setSection = (next: RestaurantSettingsNavId | undefined, opts?: { replace?: boolean }) => {
		navigate({
			to: "/admin/restaurants",
			search: (prev) => ({ ...prev, section: next }),
			replace: opts?.replace ?? false,
		});
	};

	// When managing one restaurant's tables or editing its settings, drop the
	// page header and the top action row entirely so the editor takes the full
	// canvas. Each canvas has its own back control, which is sufficient
	// chrome. On a phone the settings canvas runs edge to edge.
	if (manageId || settingsId) {
		return (
			<div className={`flex flex-col h-full ${settingsId ? "p-0 md:p-4 lg:p-6" : "p-6"}`}>
				<div className="flex-1 min-h-0 overflow-y-auto">
					<AdminRestaurantsList
						manageId={manageId}
						onManageChange={setManageId}
						settingsId={settingsId}
						onSettingsChange={setSettingsId}
						settingsSection={section}
						onSettingsSectionChange={setSection}
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
