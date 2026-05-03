import { MenuEditor, MenuEditorSkeleton } from "@/features/menus";
import { useRestaurant } from "@/features/restaurants";
import { MenusKeys } from "@/global/i18n";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";
import { ArrowLeft } from "lucide-react";
import { useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/menus/$menuId")({
	component: MenuEditorPage,
});

function MenuEditorPage() {
	const { t } = useTranslation();
	const { menuId } = Route.useParams();
	const navigate = useNavigate();
	const { restaurant, isLoading } = useRestaurant();
	const {
		data: menu,
		isLoading: menuLoading,
	} = useQuery(convexQuery(api.menus.getMenuById, { menuId: menuId as Id<"menus"> }));

	const canEdit =
		Boolean(restaurant && menu && menu.restaurantId === restaurant._id);

	useLayoutEffect(() => {
		if (isLoading || !restaurant || menuLoading) return;
		if (!menu || menu.restaurantId !== restaurant._id) {
			navigate({ to: "/admin/menus", search: { view: undefined }, replace: true });
		}
	}, [isLoading, restaurant, menuLoading, menu, navigate]);

	const showSkeleton = isLoading || !restaurant || menuLoading || !canEdit;

	return (
		<div className="p-6 flex flex-col h-full">
			<div className="mb-6">
				<Link
					to="/admin/menus"
					search={{ view: "list" }}
					className="flex items-center gap-1 text-sm mb-3 hover:underline text-primary"
				>
					<ArrowLeft size={16} /> {t(MenusKeys.EDITOR_BACK_TO_LIST)}
				</Link>
				<h1 className="text-2xl font-semibold text-foreground">{t(MenusKeys.EDITOR_HEADER_TITLE)}</h1>
				<p className="mt-2 text-sm text-muted-foreground">{t(MenusKeys.EDITOR_HEADER_DESCRIPTION)}</p>
			</div>
			<div className="flex-1 overflow-y-auto">
				{showSkeleton && <MenuEditorSkeleton />}
				{!showSkeleton && restaurant && (
					<MenuEditor menuId={menuId as Id<"menus">} restaurantId={restaurant._id} />
				)}
			</div>
		</div>
	);
}
