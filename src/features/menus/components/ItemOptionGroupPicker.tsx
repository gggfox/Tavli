import { MenusKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useTranslation } from "react-i18next";

interface ItemOptionGroupPickerProps {
	itemId: Id<"menuItems">;
	restaurantId: Id<"restaurants">;
}

export function ItemOptionGroupPicker({
	itemId,
	restaurantId,
}: Readonly<ItemOptionGroupPickerProps>) {
	const { t } = useTranslation();
	const { data: allGroups } = useQuery(
		convexQuery(api.optionGroups.getGroupsByRestaurant, { restaurantId })
	);
	const { data: linkedGroups } = useQuery(
		convexQuery(api.optionGroups.getGroupsForMenuItem, { menuItemId: itemId })
	);

	const linkMutation = useMutation({
		mutationFn: useConvexMutation(api.optionGroups.linkToMenuItem),
	});
	const unlinkMutation = useMutation({
		mutationFn: useConvexMutation(api.optionGroups.unlinkFromMenuItem),
	});

	const linkedIds = new Set((linkedGroups ?? []).map((g: any) => g._id as string));
	const sorted = [...(allGroups ?? [])].sort((a, b) => a.displayOrder - b.displayOrder);

	const handleToggle = async (groupId: Id<"optionGroups">) => {
		if (linkedIds.has(groupId)) {
			unwrapResult(
				await unlinkMutation.mutateAsync({ menuItemId: itemId, optionGroupId: groupId })
			);
		} else {
			unwrapResult(
				await linkMutation.mutateAsync({
					menuItemId: itemId,
					optionGroupId: groupId,
					restaurantId,
				})
			);
		}
	};

	if (sorted.length === 0) {
		return (
			<div
				className="px-3 py-3 text-xs rounded-b-lg bg-muted border-l border-border border-r border-border border-b border-border text-faint-foreground"
				
			>
				{t(MenusKeys.PICKER_NO_GROUPS)}
			</div>
		);
	}

	return (
		<div
			className="px-3 py-3 rounded-b-lg space-y-2 bg-muted border-l border-border border-r border-border border-b border-border"
			
		>
			<span className="text-xs font-medium text-faint-foreground" >
				{t(MenusKeys.PICKER_LINKED_GROUPS)}
			</span>
			<div className="flex flex-wrap gap-2">
				{sorted.map((group) => {
					const isLinked = linkedIds.has(group._id);
					return (
						<button
							key={group._id}
							onClick={() => handleToggle(group._id)}
							disabled={linkMutation.isPending || unlinkMutation.isPending}
							className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors disabled:opacity-50"
							style={{backgroundColor: isLinked ? "var(--btn-primary-bg)" : "var(--bg-primary)",
				color: isLinked ? "var(--btn-primary-text)" : "var(--text-secondary)",
				border: isLinked ? "1px solid transparent" : "1px solid var(--border-default)"}}
						>
							{group.name}
							<span className="ml-1 opacity-70">
								{group.selectionType === "single"
									? t(MenusKeys.PICKER_GROUP_SINGLE)
									: t(MenusKeys.PICKER_GROUP_MULTI)}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
