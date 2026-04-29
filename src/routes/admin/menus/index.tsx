import { MenuList, MenuListSkeleton, useMenus } from "@/features/menus";
import { useRestaurant } from "@/features/restaurants";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";
import type { ComponentProps } from "react";

export const Route = createFileRoute("/admin/menus/")({
	component: MenusPage,
});

type MenuListBindings = Pick<
	ComponentProps<typeof MenuList>,
	"menus" | "onCreate" | "onUpdate" | "onDelete"
>;

function MenusPage() {
	const { restaurant, isLoading } = useRestaurant();
	const { menus, createMenu, updateMenu, deleteMenu } = useMenus(restaurant?._id);
	const navigate = useNavigate();

	const handleSelect = (menuId: Id<"menus">) =>
		navigate({ to: "/admin/menus/$menuId", params: { menuId } });

	return (
		<div className="p-6 flex flex-col h-full">
			<div className="mb-6">
				<h1 className="text-2xl font-semibold text-foreground" >
					Menus
				</h1>
				<p className="mt-2 text-sm text-muted-foreground" >
					Create and manage your restaurant&apos;s menus. Click a menu to edit its categories and
					items.
				</p>
			</div>
			<div className="flex-1 overflow-y-auto">
				<MenusContent
					restaurantId={restaurant?._id}
					isLoading={isLoading}
					menus={menus}
					onCreate={createMenu}
					onUpdate={updateMenu}
					onDelete={deleteMenu}
					onSelect={handleSelect}
				/>
			</div>
		</div>
	);
}

function MenusContent({
	restaurantId,
	isLoading,
	menus,
	onCreate,
	onUpdate,
	onDelete,
	onSelect,
}: Readonly<
	MenuListBindings & {
		restaurantId: Id<"restaurants"> | undefined;
		isLoading: boolean;
		onSelect: (menuId: Id<"menus">) => void;
	}
>) {
	if (isLoading) return <MenuListSkeleton />;
	if (!restaurantId) {
		return (
			<p className="text-sm text-faint-foreground" >
				Please set up your restaurant first.
			</p>
		);
	}
	return (
		<MenuList
			menus={menus}
			restaurantId={restaurantId}
			onCreate={onCreate}
			onUpdate={onUpdate}
			onDelete={onDelete}
			onSelect={onSelect}
		/>
	);
}
