import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";

export function useMenus(restaurantId: Id<"restaurants"> | undefined) {
	const { data: menus, isLoading } = useQuery(
		convexQuery(api.menus.getMenusByRestaurant, restaurantId ? { restaurantId } : "skip")
	);

	const createMenu = useMutation({ mutationFn: useConvexMutation(api.menus.createMenu) });
	const updateMenu = useMutation({ mutationFn: useConvexMutation(api.menus.updateMenu) });
	const deleteMenu = useMutation({ mutationFn: useConvexMutation(api.menus.deleteMenu) });

	const createCategory = useMutation({ mutationFn: useConvexMutation(api.menus.createCategory) });
	const updateCategory = useMutation({ mutationFn: useConvexMutation(api.menus.updateCategory) });
	const deleteCategory = useMutation({ mutationFn: useConvexMutation(api.menus.deleteCategory) });

	return {
		menus: menus ?? [],
		isLoading,
		createMenu: createMenu.mutateAsync,
		updateMenu: updateMenu.mutateAsync,
		deleteMenu: deleteMenu.mutateAsync,
		createCategory: createCategory.mutateAsync,
		updateCategory: updateCategory.mutateAsync,
		deleteCategory: deleteCategory.mutateAsync,
	};
}

export function useCategories(menuId: Id<"menus"> | undefined) {
	const { data, isLoading } = useQuery(
		convexQuery(api.menus.getCategoriesByMenu, menuId ? { menuId } : "skip")
	);

	return { categories: data ?? [], isLoading };
}

export function useMenuItems(categoryId: Id<"menuCategories"> | undefined) {
	const { data, isLoading } = useQuery(
		convexQuery(api.menuItems.getByCategory, categoryId ? { categoryId } : "skip")
	);

	const createItem = useMutation({ mutationFn: useConvexMutation(api.menuItems.create) });
	const updateItem = useMutation({ mutationFn: useConvexMutation(api.menuItems.update) });
	const removeItem = useMutation({ mutationFn: useConvexMutation(api.menuItems.remove) });
	const toggleAvailability = useMutation({
		mutationFn: useConvexMutation(api.menuItems.toggleAvailability),
	});

	return {
		items: data ?? [],
		isLoading,
		createItem: createItem.mutateAsync,
		updateItem: updateItem.mutateAsync,
		removeItem: removeItem.mutateAsync,
		toggleAvailability: toggleAvailability.mutateAsync,
	};
}
