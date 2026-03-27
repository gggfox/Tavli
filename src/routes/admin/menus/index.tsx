import { MenuList, useMenus } from "@/features/menus";
import { useRestaurant } from "@/features/restaurants";
import { LoadingState } from "@/global/components";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/menus/")({
	component: MenusPage,
});

function MenusPage() {
	const { restaurant, isLoading } = useRestaurant();
	const { menus, createMenu, updateMenu, deleteMenu } = useMenus(restaurant?._id);
	const navigate = useNavigate();

	if (isLoading) {
		return (
			<div className="p-6">
				<LoadingState />
			</div>
		);
	}

	if (!restaurant) {
		return (
			<div className="p-6">
				<p className="text-sm" style={{ color: "var(--text-muted)" }}>
					Please set up your restaurant first.
				</p>
			</div>
		);
	}

	return (
		<div className="p-6 flex flex-col h-full">
			<div className="mb-6">
				<h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
					Menus
				</h1>
				<p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
					Create and manage your restaurant&apos;s menus. Click a menu to edit its categories and
					items.
				</p>
			</div>
			<div className="flex-1 overflow-y-auto">
				<MenuList
					menus={menus}
					restaurantId={restaurant._id}
					onCreate={createMenu}
					onUpdate={updateMenu}
					onDelete={deleteMenu}
					onSelect={(menuId) => navigate({ to: "/admin/menus/$menuId", params: { menuId } })}
				/>
			</div>
		</div>
	);
}
