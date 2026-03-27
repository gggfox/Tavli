import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";

export function useOptionGroups(restaurantId: Id<"restaurants"> | undefined) {
	const { data, isLoading } = useQuery({
		...convexQuery(api.optionGroups.getGroupsByRestaurant, { restaurantId: restaurantId! }),
		enabled: !!restaurantId,
	});

	const createGroup = useMutation({ mutationFn: useConvexMutation(api.optionGroups.createGroup) });
	const updateGroup = useMutation({ mutationFn: useConvexMutation(api.optionGroups.updateGroup) });
	const deleteGroup = useMutation({ mutationFn: useConvexMutation(api.optionGroups.deleteGroup) });

	const createOption = useMutation({
		mutationFn: useConvexMutation(api.optionGroups.createOption),
	});
	const updateOption = useMutation({
		mutationFn: useConvexMutation(api.optionGroups.updateOption),
	});
	const deleteOption = useMutation({
		mutationFn: useConvexMutation(api.optionGroups.deleteOption),
	});

	const linkToMenuItem = useMutation({
		mutationFn: useConvexMutation(api.optionGroups.linkToMenuItem),
	});
	const unlinkFromMenuItem = useMutation({
		mutationFn: useConvexMutation(api.optionGroups.unlinkFromMenuItem),
	});

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
	const { data } = useQuery({
		...convexQuery(api.optionGroups.getOptionsByGroup, { optionGroupId: optionGroupId! }),
		enabled: !!optionGroupId,
	});
	return data ?? [];
}
