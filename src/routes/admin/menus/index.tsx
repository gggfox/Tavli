import { ExportMenuButton, useCanExport } from "@/features/exports";
import { MenuImportDialog, MenuList, MenuListSkeleton, useMenus } from "@/features/menus";
import { useRestaurant } from "@/features/restaurants";
import { AdminPageLayout, Button } from "@/global/components";
import { MenusKeys } from "@/global/i18n";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Id } from "convex/_generated/dataModel";
import type { ComponentProps } from "react";
import { FileUp } from "lucide-react";

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
	const { canExport } = useCanExport(restaurant?._id, restaurant?.organizationId);
	const { menus, updateMenu, isLoading: menusLoading } = useMenus(restaurant?._id);
	const navigate = useNavigate();
	const [importOpen, setImportOpen] = useState(false);

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
		<AdminPageLayout
			actions={
				<>
					{restaurant ? (
						<Button
							variant="secondary"
							size="md"
							leadingIcon={<FileUp size={14} />}
							onClick={() => setImportOpen(true)}
						>
							{t(MenusKeys.IMPORT_BUTTON)}
						</Button>
					) : null}
					{restaurant && canExport ? <ExportMenuButton restaurantId={restaurant._id} /> : null}
				</>
			}
		>
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
					onImportClick={() => setImportOpen(true)}
				/>
			)}
			{restaurant && (
				<MenuImportDialog
					isOpen={importOpen}
					onClose={() => setImportOpen(false)}
					restaurantId={restaurant._id}
					menus={menus}
				/>
			)}
		</AdminPageLayout>
	);
}

function MenusContent({
	setupFirstMessage,
	restaurantId,
	isLoading,
	menus,
	onUpdate,
	onSelect,
	onImportClick,
}: Readonly<
	MenuListBindings & {
		setupFirstMessage: string;
		restaurantId: Id<"restaurants"> | undefined;
		isLoading: boolean;
		onSelect: (menuId: Id<"menus">) => void;
		onImportClick: () => void;
	}
>) {
	const { t } = useTranslation();

	if (isLoading) return <MenuListSkeleton />;
	if (!restaurantId) {
		return <p className="text-sm text-faint-foreground">{setupFirstMessage}</p>;
	}

	if (menus.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-16 gap-4">
				<FileUp className="text-muted-foreground" size={40} />
				<h3 className="text-lg font-medium text-foreground">
					{t(MenusKeys.IMPORT_EMPTY_CTA_TITLE)}
				</h3>
				<p className="text-sm text-muted-foreground text-center max-w-md">
					{t(MenusKeys.IMPORT_EMPTY_CTA_DESCRIPTION)}
				</p>
				<button
					onClick={onImportClick}
					className="flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
				>
					<FileUp size={16} />
					{t(MenusKeys.IMPORT_BUTTON)}
				</button>
			</div>
		);
	}

	return <MenuList menus={menus} onUpdate={onUpdate} onSelect={onSelect} />;
}
