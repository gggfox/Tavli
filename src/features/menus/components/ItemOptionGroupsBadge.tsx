import { MenusKeys } from "@/global/i18n";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ItemOptionGroupsBadgeProps {
	itemId: Id<"menuItems">;
}

/**
 * Names the option groups linked to a menu item, right on the row.
 *
 * Replaces a dot on a toggle button that only told you *that* an item had
 * option groups after you went looking. The groups themselves are edited in
 * the item edit panel (`ItemOptionGroupPicker`), so this is read-only.
 */
export function ItemOptionGroupsBadge({ itemId }: Readonly<ItemOptionGroupsBadgeProps>) {
	const { t } = useTranslation();
	const { data: linkedGroups } = useQuery(
		convexQuery(api.optionGroups.getGroupsForMenuItem, { menuItemId: itemId })
	);

	const names = (linkedGroups ?? [])
		.filter((group): group is NonNullable<typeof group> => group != null)
		.map((group) => group.name);

	if (names.length === 0) return null;

	const label = names.join(", ");
	return (
		<span
			title={t(MenusKeys.PICKER_BADGE_LABEL, { names: label })}
			className="ml-3 inline-flex max-w-[16rem] items-center gap-1 rounded-full px-2 py-0.5 align-middle text-xs bg-muted text-muted-foreground"
		>
			<ListChecks size={12} className="shrink-0" />
			<span className="truncate">{label}</span>
		</span>
	);
}
