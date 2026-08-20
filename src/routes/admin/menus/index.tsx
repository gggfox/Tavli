import { ExportMenuButton, useCanExport } from "@/features/exports";
import {
	MenuCreateDialog,
	MenuImportDialog,
	MenuList,
	MenuListSkeleton,
	useMenus,
} from "@/features/menus";
import { useRestaurant } from "@/features/restaurants";
import { AdminPageLayout, Button } from "@/global/components";
import { MenusKeys } from "@/global/i18n";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Id } from "convex/_generated/dataModel";
import type { ComponentProps, ReactNode } from "react";
import { FileUp, Plus } from "lucide-react";

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
	const [createOpen, setCreateOpen] = useState(false);

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
						<>
							<Button
								variant="primary"
								size="md"
								leadingIcon={<Plus size={14} />}
								onClick={() => setCreateOpen(true)}
							>
								{t(MenusKeys.LIST_ADD_BUTTON)}
							</Button>
							<Button
								variant="secondary"
								size="md"
								leadingIcon={<FileUp size={14} />}
								onClick={() => setImportOpen(true)}
							>
								{t(MenusKeys.IMPORT_BUTTON)}
							</Button>
						</>
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
					onCreateClick={() => setCreateOpen(true)}
				/>
			)}
			{restaurant && (
				<>
					<MenuImportDialog
						isOpen={importOpen}
						onClose={() => setImportOpen(false)}
						restaurantId={restaurant._id}
						menus={menus}
					/>
					<MenuCreateDialog
						isOpen={createOpen}
						onClose={() => setCreateOpen(false)}
						restaurantId={restaurant._id}
						onCreated={handleSelect}
					/>
				</>
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
	onCreateClick,
}: Readonly<
	MenuListBindings & {
		setupFirstMessage: string;
		restaurantId: Id<"restaurants"> | undefined;
		isLoading: boolean;
		onSelect: (menuId: Id<"menus">) => void;
		onImportClick: () => void;
		onCreateClick: () => void;
	}
>) {
	const { t } = useTranslation();

	if (isLoading) return <MenuListSkeleton />;
	if (!restaurantId) {
		return <p className="text-sm text-faint-foreground">{setupFirstMessage}</p>;
	}

	if (menus.length === 0) {
		return (
			<div className="grid gap-4 py-8 md:grid-cols-2">
				<EmptyStartCard
					icon={<Plus className="text-muted-foreground" size={32} />}
					title={t(MenusKeys.LIST_EMPTY_CREATE_TITLE)}
					description={t(MenusKeys.LIST_EMPTY_CREATE_DESCRIPTION)}
					action={
						<Button
							variant="primary"
							size="md"
							leadingIcon={<Plus size={14} />}
							onClick={onCreateClick}
						>
							{t(MenusKeys.LIST_ADD_BUTTON)}
						</Button>
					}
				/>
				<EmptyStartCard
					icon={<FileUp className="text-muted-foreground" size={32} />}
					title={t(MenusKeys.IMPORT_EMPTY_CTA_TITLE)}
					description={t(MenusKeys.IMPORT_EMPTY_CTA_DESCRIPTION)}
					action={
						<Button
							variant="secondary"
							size="md"
							leadingIcon={<FileUp size={14} />}
							onClick={onImportClick}
						>
							{t(MenusKeys.IMPORT_BUTTON)}
						</Button>
					}
				/>
			</div>
		);
	}

	return <MenuList menus={menus} onUpdate={onUpdate} onSelect={onSelect} />;
}

/**
 * One of the two "you have no menus yet" starting points: create an empty
 * menu, or import one from a document. Both paths are offered side by side so
 * a brand-new restaurant is never stuck behind the document importer.
 */
function EmptyStartCard({
	icon,
	title,
	description,
	action,
}: Readonly<{
	icon: ReactNode;
	title: string;
	description: string;
	action: ReactNode;
}>) {
	return (
		<div className="flex flex-col items-center justify-between gap-4 rounded-lg border border-border bg-muted px-6 py-10 text-center">
			{icon}
			<div className="space-y-1">
				<h3 className="text-base font-medium text-foreground">{title}</h3>
				<p className="text-sm text-muted-foreground max-w-xs">{description}</p>
			</div>
			{action}
		</div>
	);
}
