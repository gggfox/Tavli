import { useConvexMutate } from "@/global/hooks";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";

export function useOptionGroups(restaurantId: Id<"restaurants"> | undefined) {
	const { data, isLoading } = useQuery(
		convexQuery(api.optionGroups.getGroupsByRestaurant, restaurantId ? { restaurantId } : "skip")
	);

	const createGroup = useConvexMutate(api.optionGroups.createGroup);
	const updateGroup = useConvexMutate(api.optionGroups.updateGroup);
	const deleteGroup = useConvexMutate(api.optionGroups.deleteGroup);

	const createOption = useConvexMutate(api.optionGroups.createOption);
	const updateOption = useConvexMutate(api.optionGroups.updateOption);
	const deleteOption = useConvexMutate(api.optionGroups.deleteOption);

	const linkToMenuItem = useConvexMutate(api.optionGroups.linkToMenuItem);
	const unlinkFromMenuItem = useConvexMutate(api.optionGroups.unlinkFromMenuItem);

	return {
		groups: data ?? [],
		isLoading,
		createGroup: createGroup.mutateAsync,
		updateGroup: updateGroup.mutateAsync,
		deleteGroup: deleteGroup.mutateAsync,
		createOption: createOption.mutateAsync,
		updateOption: updateOption.mutateAsync,
		deleteOption: deleteOption.mutateAsync,
		linkToMenuItem: linkToMenuItem.mutateAsync,
		unlinkFromMenuItem: unlinkFromMenuItem.mutateAsync,
	};
}

export function useOptionsForGroup(optionGroupId: Id<"optionGroups"> | undefined) {
	const { data } = useQuery(
		convexQuery(api.optionGroups.getOptionsByGroup, optionGroupId ? { optionGroupId } : "skip")
	);
	return data ?? [];
}
