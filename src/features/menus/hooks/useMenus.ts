import { useConvexMutate } from "@/global/hooks";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";

export function useMenus(restaurantId: Id<"restaurants"> | undefined) {
	const { data: menus, isLoading } = useQuery(
		convexQuery(api.menus.getMenusByRestaurant, restaurantId ? { restaurantId } : "skip")
	);

	const updateMenu = useConvexMutate(api.menus.updateMenu);

	const createCategory = useConvexMutate(api.menus.createCategory);
	const updateCategory = useConvexMutate(api.menus.updateCategory);
	const deleteCategory = useConvexMutate(api.menus.deleteCategory);

	return {
		menus: menus ?? [],
		isLoading,
		updateMenu: updateMenu.mutateAsync,
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

export function useMenuItems(
	categoryId: Id<"menuCategories"> | undefined,
	restaurantId: Id<"restaurants"> | undefined
) {
	const { data, isLoading } = useQuery(
		convexQuery(api.menuItems.getByCategory, categoryId ? { categoryId } : "skip")
	);

	const createItem = useConvexMutate(api.menuItems.create);
	const updateItem = useConvexMutate(api.menuItems.update);
	const removeItem = useConvexMutate(api.menuItems.remove);
	const toggleAvailability = useConvexMutate(api.menuItems.toggleAvailability);
	const bulkRemoveItems = useConvexMutate(api.menuItems.bulkRemove);
	const bulkSetAvailability = useConvexMutate(api.menuItems.bulkSetAvailability);
	// `generateUploadUrl` is intentionally NOT wrapped in React Query: callers
	// invoke it imperatively as part of an upload pipeline (request URL ->
	// upload file -> persist storageId), not as a top-level mutation whose
	// status the UI tracks.
	const generateUploadUrlMutation = useConvexMutation(api.menuItems.generateUploadUrl);

	const generateUploadUrl = (): Promise<[string, null] | [null, unknown]> => {
		if (!restaurantId) {
			return Promise.resolve([null, { code: "MISSING_RESTAURANT_ID" }]);
		}
		return generateUploadUrlMutation({ restaurantId }) as Promise<[string, null] | [null, unknown]>;
	};

	return {
		items: data ?? [],
		isLoading,
		createItem: createItem.mutateAsync,
		updateItem: updateItem.mutateAsync,
		removeItem: removeItem.mutateAsync,
		toggleAvailability: toggleAvailability.mutateAsync,
		bulkRemoveItems: bulkRemoveItems.mutateAsync,
		bulkSetAvailability: bulkSetAvailability.mutateAsync,
		generateUploadUrl,
	};
}
