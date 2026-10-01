/**
 * Checks picks kept across sign-in (`storedPicks`) against the live menu.
 *
 * The picks were made minutes (up to `STORED_PICKS_TTL_MS`) ago, and the menu
 * can change in between: a dish pulled at lunch, a price not set yet, a salsa
 * that ran out. A restored pick the diner can no longer order would only meet
 * the server's refusal at checkout, so it is dropped here instead and the
 * caller tells the diner something was removed. What survives is refreshed
 * from the menu — price, option names in the current language, option prices —
 * so the order bar's total is the one checkout will charge.
 */
import { getTranslatedField } from "@/global/utils/translations";
import type { Id } from "convex/_generated/dataModel";
import { MAX_ORDER_ITEM_QUANTITY } from "convex/constants";
import type { SelectedOption } from "../types";
import type { DraftLine } from "./menuPicks";
import { isItemAvailableToday } from "./menuLayout";

/** The parts of a menu item (`menuItems.getByRestaurant`) the check reads. */
export interface RestorableMenuItem {
	_id: Id<"menuItems">;
	isAvailable: boolean;
	basePrice: number;
	availableDays?: readonly number[];
}

/** The parts of an option group (`optionGroups.getGroupsForMenuItem`) the check reads. */
export interface RestorableOptionGroup {
	_id: Id<"optionGroups">;
	name: string;
	translations?: Record<string, { name?: string; description?: string }>;
	options?: ReadonlyArray<{
		_id: Id<"options">;
		name: string;
		translations?: Record<string, { name?: string; description?: string }>;
		isAvailable: boolean;
		priceModifier: number;
	}>;
}

export interface RestoredLines {
	lines: DraftLine[];
	/** Did any stored pick have to go? The caller owes the diner a notice. */
	droppedSome: boolean;
}

/**
 * Keeps the stored lines the diner can still order, today, as they were
 * picked.
 *
 * A line is dropped when its dish is missing from the menu, switched off, not
 * on today's menu, or has no price (`isItemAvailableToday` covers all three
 * the same way the menu listing does), or when any option it chose is no
 * longer offered on that dish. The whole line goes rather than just the
 * option: "tacos with salsa verde" silently becoming plain tacos is a
 * different dish from the one the diner chose. Quantities are clamped to
 * `MAX_ORDER_ITEM_QUANTITY`, the stepper's and the server's cap; that is a
 * correction, not a removal, so it raises no notice.
 *
 * `optionGroupsByItem` needs an entry only for dishes whose line chose
 * options; a missing entry for such a dish counts as "options gone".
 */
export function validateRestoredLines(
	lines: readonly DraftLine[],
	menu: {
		items: ReadonlyMap<string, RestorableMenuItem>;
		optionGroupsByItem: ReadonlyMap<string, readonly RestorableOptionGroup[]>;
		dayOfWeek: number;
		lang?: string;
	}
): RestoredLines {
	const kept: DraftLine[] = [];
	let droppedSome = false;
	for (const line of lines) {
		const restored = restoreLine(line, menu);
		if (restored) kept.push(restored);
		else droppedSome = true;
	}
	return { lines: kept, droppedSome };
}

function restoreLine(
	line: DraftLine,
	menu: Parameters<typeof validateRestoredLines>[1]
): DraftLine | null {
	const item = menu.items.get(line.menuItemId);
	if (!item || !isItemAvailableToday(item, menu.dayOfWeek)) return null;
	if (!Number.isFinite(line.quantity) || line.quantity < 1) return null;

	const selectedOptions: SelectedOption[] = [];
	if (line.selectedOptions.length > 0) {
		const groups = menu.optionGroupsByItem.get(line.menuItemId);
		if (!groups) return null;
		for (const chosen of line.selectedOptions) {
			const group = groups.find((g) => g._id === chosen.optionGroupId);
			const option = group?.options?.find((o) => o._id === chosen.optionId && o.isAvailable);
			if (!group || !option) return null;
			selectedOptions.push({
				optionGroupId: group._id,
				optionGroupName: getTranslatedField(group, menu.lang),
				optionId: option._id,
				optionName: getTranslatedField(option, menu.lang),
				priceModifier: option.priceModifier,
			});
		}
	}

	return {
		menuItemId: item._id,
		quantity: Math.min(MAX_ORDER_ITEM_QUANTITY, Math.floor(line.quantity)),
		unitPrice: item.basePrice,
		selectedOptions,
	};
}
