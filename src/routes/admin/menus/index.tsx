import { ExportMenuButton, useCanExport } from "@/features/exports";
import { MenuImportDialog, MenuList, MenuListSkeleton, useMenus } from "@/features/menus";
import { useRestaurant } from "@/features/restaurants";
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
		<div className="p-6 flex flex-col h-full">
			<div className="mb-6 flex items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold text-foreground">{t(MenusKeys.PAGE_TITLE)}</h1>
					<p className="mt-2 text-sm text-muted-foreground">{t(MenusKeys.PAGE_DESCRIPTION)}</p>
				</div>
				<div className="flex items-center gap-2">
					{restaurant && (
						<button
							onClick={() => setImportOpen(true)}
							className="flex items-center gap-2 px-3 py-2 text-sm rounded-md border border-border text-foreground hover:bg-hover"
						>
							<FileUp size={16} />
							{t(MenusKeys.IMPORT_BUTTON)}
						</button>
					)}
					{restaurant && canExport ? <ExportMenuButton restaurantId={restaurant._id} /> : null}
				</div>
			</div>
			<div className="flex-1 min-h-0 overflow-y-auto">
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
			</div>
			{restaurant && (
				<MenuImportDialog
					isOpen={importOpen}
					onClose={() => setImportOpen(false)}
					restaurantId={restaurant._id}
					menus={menus}
				/>
			)}
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

	return (
		<MenuList menus={menus} onUpdate={onUpdate} onSelect={onSelect} />
	);
}
