import { useConvexMutate } from "@/global/hooks";
import { MenusKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useTranslation } from "react-i18next";

const panelClassName =
	"px-3 py-3 text-xs rounded-b-lg bg-muted border-l border-border border-r border-border border-b border-border";

interface ItemOptionGroupPickerProps {
	itemId: Id<"menuItems">;
	/** Must match the owning menu item's `restaurantId` (not necessarily the navbar selection). */
	restaurantId: Id<"restaurants">;
}

export function ItemOptionGroupPicker({
	itemId,
	restaurantId,
}: Readonly<ItemOptionGroupPickerProps>) {
	const { t } = useTranslation();
	const allGroupsQuery = useQuery(
		convexQuery(api.optionGroups.getGroupsByRestaurant, { restaurantId })
	);
	const linkedGroupsQuery = useQuery(
		convexQuery(api.optionGroups.getGroupsForMenuItem, { menuItemId: itemId })
	);

	const linkMutation = useConvexMutate(api.optionGroups.linkToMenuItem);
	const unlinkMutation = useConvexMutate(api.optionGroups.unlinkFromMenuItem);

	const loading = allGroupsQuery.isPending || linkedGroupsQuery.isPending;
	const loadError = allGroupsQuery.isError || linkedGroupsQuery.isError;

	const allGroups = allGroupsQuery.data;
	const linkedGroups = linkedGroupsQuery.data;

	const linkedIds = new Set(
		(linkedGroups ?? []).filter((g): g is NonNullable<typeof g> => g != null).map((g) => g._id)
	);
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

	if (loading) {
		return (
			<div className={`${panelClassName} text-muted-foreground animate-pulse`}>
				{t(MenusKeys.PICKER_LOADING)}
			</div>
		);
	}

	if (loadError) {
		return (
			<div className={`${panelClassName} text-destructive`}>{t(MenusKeys.PICKER_ERROR)}</div>
		);
	}

	if (sorted.length === 0) {
		return <div className={`${panelClassName} text-faint-foreground`}>{t(MenusKeys.PICKER_NO_GROUPS)}</div>;
	}

	return (
		<div className="px-3 py-3 rounded-b-lg space-y-2 bg-muted border-l border-border border-r border-border border-b border-border">
			<span className="text-xs font-medium text-faint-foreground">
				{t(MenusKeys.PICKER_LINKED_GROUPS)}
			</span>
			<div className="flex flex-wrap gap-2">
				{sorted.map((group) => {
					const isLinked = linkedIds.has(group._id);
					return (
						<button
							key={group._id}
							type="button"
							onClick={() => handleToggle(group._id)}
							disabled={linkMutation.isPending || unlinkMutation.isPending}
							className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors disabled:opacity-50"
							style={{
								backgroundColor: isLinked ? "var(--btn-primary-bg)" : "var(--bg-primary)",
								color: isLinked ? "var(--btn-primary-text)" : "var(--text-secondary)",
								border: isLinked ? "1px solid transparent" : "1px solid var(--border-default)",
							}}
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
