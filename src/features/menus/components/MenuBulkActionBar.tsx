import { useConvexMutate } from "@/global/hooks";
import { MenusKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useTranslation } from "react-i18next";

interface MenuBulkActionBarProps {
	restaurantId: Id<"restaurants">;
	selectedIds: ReadonlySet<Id<"menuItems">>;
	onClearSelection: () => void;
}

export function MenuBulkActionBar({
	restaurantId,
	selectedIds,
	onClearSelection,
}: Readonly<MenuBulkActionBarProps>) {
	const { t } = useTranslation();
	const bulkRemoveItems = useConvexMutate(api.menuItems.bulkRemove);
	const bulkSetAvailability = useConvexMutate(api.menuItems.bulkSetAvailability);
	const bulkSetPrepStation = useConvexMutate(api.menuItems.bulkSetPrepStation);

	const itemIds = [...selectedIds];

	const runBulk = async (fn: () => Promise<unknown>) => {
		if (itemIds.length === 0) return;
		await fn();
		onClearSelection();
	};

	return (
		<div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
			<span className="text-xs text-muted-foreground">
				{t(MenusKeys.EDITOR_BULK_SELECTED_COUNT, { count: selectedIds.size })}
			</span>
			<button
				type="button"
				onClick={() =>
					void runBulk(async () => {
						unwrapResult(
							await bulkSetAvailability.mutateAsync({
								restaurantId,
								itemIds,
								isAvailable: false,
							})
						);
					})
				}
				className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-hover"
			>
				{t(MenusKeys.CATEGORY_BULK_HIDE)}
			</button>
			<button
				type="button"
				onClick={() =>
					void runBulk(async () => {
						unwrapResult(
							await bulkSetAvailability.mutateAsync({
								restaurantId,
								itemIds,
								isAvailable: true,
							})
						);
					})
				}
				className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-hover"
			>
				{t(MenusKeys.CATEGORY_BULK_SHOW)}
			</button>
			<button
				type="button"
				onClick={() =>
					void runBulk(async () => {
						unwrapResult(
							await bulkSetPrepStation.mutateAsync({
								restaurantId,
								itemIds,
								prepStation: "kitchen",
							})
						);
					})
				}
				className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-hover"
			>
				{t(MenusKeys.CATEGORY_BULK_MARK_KITCHEN)}
			</button>
			<button
				type="button"
				onClick={() =>
					void runBulk(async () => {
						unwrapResult(
							await bulkSetPrepStation.mutateAsync({
								restaurantId,
								itemIds,
								prepStation: "bar",
							})
						);
					})
				}
				className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-hover"
			>
				{t(MenusKeys.CATEGORY_BULK_MARK_BAR)}
			</button>
			<button
				type="button"
				onClick={() =>
					void runBulk(async () => {
						unwrapResult(await bulkRemoveItems.mutateAsync({ restaurantId, itemIds }));
					})
				}
				className="rounded-md border border-border px-2 py-1 text-xs font-medium text-destructive hover:bg-hover"
			>
				{t(MenusKeys.CATEGORY_BULK_DELETE)}
			</button>
		</div>
	);
}
