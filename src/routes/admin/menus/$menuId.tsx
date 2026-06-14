import { ExportMenuButton, useCanExport } from "@/features/exports";
import { AddCategoriesModal, MenuEditor, MenuEditorSkeleton } from "@/features/menus";
import { useRestaurant } from "@/features/restaurants";
import { AdminPageLayout, Button } from "@/global/components";
import { MenusKeys } from "@/global/i18n";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";
import { ArrowLeft, Plus } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/menus/$menuId")({
	component: MenuEditorPage,
});

function MenuEditorPage() {
	const { t } = useTranslation();
	const { menuId } = Route.useParams();
	const navigate = useNavigate();
	const { restaurant, isLoading } = useRestaurant();
	const { canExport } = useCanExport(restaurant?._id, restaurant?.organizationId);
	const { data: menu, isLoading: menuLoading } = useQuery(
		convexQuery(api.menus.getMenuById, { menuId: menuId as Id<"menus"> })
	);

	const canEdit = Boolean(restaurant && menu && menu.restaurantId === restaurant._id);

	useLayoutEffect(() => {
		if (isLoading || !restaurant || menuLoading) return;
		if (!menu || menu.restaurantId !== restaurant._id) {
			navigate({ to: "/admin/menus", search: { view: undefined }, replace: true });
		}
	}, [isLoading, restaurant, menuLoading, menu, navigate]);

	const showSkeleton = isLoading || !restaurant || menuLoading || !canEdit;
	const [addCategoriesOpen, setAddCategoriesOpen] = useState(false);
	const [isTranslationMode, setIsTranslationMode] = useState(false);

	return (
		<AdminPageLayout
			breadcrumb={
				<Link
					to="/admin/menus"
					search={{ view: "list" }}
					className="flex items-center gap-1 text-sm hover:underline text-primary"
				>
					<ArrowLeft size={16} /> {t(MenusKeys.EDITOR_BACK_TO_LIST)}
				</Link>
			}
			actions={
				<>
					{!isTranslationMode ? (
						<Button
							variant="primary"
							size="md"
							leadingIcon={<Plus size={14} />}
							onClick={() => setAddCategoriesOpen(true)}
						>
							{t(MenusKeys.EDITOR_ADD_CATEGORY)}
						</Button>
					) : null}
					{restaurant && canExport ? <ExportMenuButton restaurantId={restaurant._id} /> : null}
				</>
			}
		>
			{restaurant && canEdit ? (
				<AddCategoriesModal
					isOpen={addCategoriesOpen}
					onClose={() => setAddCategoriesOpen(false)}
					menuId={menuId as Id<"menus">}
					restaurantId={restaurant._id}
				/>
			) : null}
			{showSkeleton && <MenuEditorSkeleton />}
			{!showSkeleton && restaurant && (
				<MenuEditor
					menuId={menuId as Id<"menus">}
					restaurantId={restaurant._id}
					onTranslationModeChange={setIsTranslationMode}
					onAddCategoriesClick={() => setAddCategoriesOpen(true)}
				/>
			)}
		</AdminPageLayout>
	);
}
