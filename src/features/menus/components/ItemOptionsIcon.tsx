import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { ListChecks } from "lucide-react";

interface ItemOptionsIconProps {
	itemId: Id<"menuItems">;
	isActive: boolean;
}

export function ItemOptionsIcon({ itemId, isActive }: Readonly<ItemOptionsIconProps>) {
	const { data: linkedGroups } = useQuery(
		convexQuery(api.optionGroups.getGroupsForMenuItem, { menuItemId: itemId })
	);
	const hasLinks = (linkedGroups ?? []).length > 0;

	return (
		<div className="relative">
			<ListChecks
				size={16}
				style={{color: isActive ? "var(--btn-primary-bg)" : "var(--text-muted)"}}
			/>
			{hasLinks && (
				<div
					className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary"
					
				/>
			)}
		</div>
	);
}
