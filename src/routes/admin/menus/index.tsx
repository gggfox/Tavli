import { MenuList, MenuListSkeleton, useMenus } from "@/features/menus";
import { useRestaurant } from "@/features/restaurants";
import { MenusKeys } from "@/global/i18n";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import type { Id } from "convex/_generated/dataModel";
import type { ComponentProps } from "react";

function validateMenusSearch(search: Record<string, unknown>) {
	const view = search.view === "list" ? "list" : undefined;
	return { view };
}

export const Route = createFileRoute("/admin/menus/")({
	validateSearch: validateMenusSearch,
	component: MenusPage,
});

type MenuListBindings = Pick<ComponentProps<typeof MenuList>, "menus" | "onUpdate">;

function MenusPage() {
	const { t } = useTranslation();
	const { view } = Route.useSearch();
	const { restaurant, isLoading } = useRestaurant();
	const { menus, updateMenu, isLoading: menusLoading } = useMenus(restaurant?._id);
	const navigate = useNavigate();

	const shouldAutoRedirect =
		view !== "list" && Boolean(restaurant) && !isLoading && !menusLoading && menus.length > 0;

	useLayoutEffect(() => {
		if (!shouldAutoRedirect || !restaurant) return;
		const sorted = [...menus].sort((a, b) => a.displayOrder - b.displayOrder);
		const first = sorted[0];
		if (!first) return;
		navigate({
			to: "/admin/menus/$menuId",
			params: { menuId: first._id },
			replace: true,
		});
	}, [shouldAutoRedirect, restaurant, menus, navigate]);

	const handleSelect = (menuId: Id<"menus">) =>
		navigate({ to: "/admin/menus/$menuId", params: { menuId } });

	return (
		<div className="p-6 flex flex-col h-full">
			<div className="mb-6">
				<h1 className="text-2xl font-semibold text-foreground">{t(MenusKeys.PAGE_TITLE)}</h1>
				<p className="mt-2 text-sm text-muted-foreground">{t(MenusKeys.PAGE_DESCRIPTION)}</p>
			</div>
			<div className="flex-1 overflow-y-auto">
				{shouldAutoRedirect ? (
					<MenuListSkeleton />
				) : (
					<MenusContent
						setupFirstMessage={t(MenusKeys.PAGE_SETUP_RESTAURANT_FIRST)}
						restaurantId={restaurant?._id}
						isLoading={isLoading || menusLoading}
						menus={menus}
						onUpdate={updateMenu}
						onSelect={handleSelect}
					/>
				)}
			</div>
		</div>
	);
}

function MenusContent({
	setupFirstMessage,
	restaurantId,
	isLoading,
	menus,
	onUpdate,
	onSelect,
}: Readonly<
	MenuListBindings & {
		setupFirstMessage: string;
		restaurantId: Id<"restaurants"> | undefined;
		isLoading: boolean;
		onSelect: (menuId: Id<"menus">) => void;
	}
>) {
	if (isLoading) return <MenuListSkeleton />;
	if (!restaurantId) {
		return <p className="text-sm text-faint-foreground">{setupFirstMessage}</p>;
	}
	return (
		<MenuList menus={menus} onUpdate={onUpdate} onSelect={onSelect} />
	);
}
