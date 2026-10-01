/**
 * The diner menu's picks, and how they are rebuilt from the session's draft.
 *
 * The menu sends its whole order every time (`orders.saveDraftFromMenu`
 * replaces the draft's lines), so it has to open holding whatever the draft
 * already holds — otherwise a diner who backs out of checkout returns to an
 * empty menu, and the next save would throw their earlier picks away.
 */
import type { Id } from "convex/_generated/dataModel";
import type { SelectedOption } from "../types";

/** One pick on the menu: a dish, how many, and its chosen options by group id. */
export interface MenuPick {
	menuItemId: Id<"menuItems">;
	quantity: number;
	basePrice: number;
	selectedOptions: Map<string, SelectedOption[]>;
}

/** A line on the session's draft, as `orders.getOrdersBySession` returns it. */
export interface DraftLine {
	menuItemId: Id<"menuItems">;
	quantity: number;
	unitPrice: number;
	selectedOptions: readonly SelectedOption[];
	cancelledAt?: number;
}

function optionsSignature(options: readonly SelectedOption[]): string {
	return options
		.map((o) => o.optionId as string)
		.sort()
		.join(",");
}

/**
 * Key of a second (third, …) way of ordering the same dish. The first way is
 * keyed by the bare `menuItemId`, which is the key the item sheet reads and
 * writes, so the ordinary one-way-per-dish menu is unchanged.
 */
function variantPickKey(menuItemId: string, options: readonly SelectedOption[]): string {
	return `${menuItemId}#${optionsSignature(options)}`;
}

/** Does the pick stored under `key` belong to this dish? */
export function isPickOfDish(key: string, menuItemId: string): boolean {
	return key === menuItemId || key.startsWith(`${menuItemId}#`);
}

function toOptionMap(options: readonly SelectedOption[]): Map<string, SelectedOption[]> {
	const byGroup = new Map<string, SelectedOption[]>();
	for (const option of options) {
		const group = byGroup.get(option.optionGroupId);
		if (group) group.push(option);
		else byGroup.set(option.optionGroupId, [option]);
	}
	return byGroup;
}

/**
 * Rebuilds the menu's picks from a draft's lines.
 *
 * Lines ordering the same dish with the same options fold into one pick with
 * their quantities summed. A dish ordered two different ways — reachable only
 * through drafts the old append path duplicated — keeps both: the first way
 * under the dish id (what the item sheet edits), each further way under its
 * own key, so nothing the diner picked is dropped by the next save. Removing
 * the dish from the item sheet removes every way of it (`isPickOfDish`).
 */
export function picksFromDraftLines(lines: readonly DraftLine[]): Map<string, MenuPick> {
	const picks = new Map<string, MenuPick>();
	const primarySignature = new Map<string, string>();
	for (const line of lines) {
		if (line.cancelledAt !== undefined) continue;
		const dish = line.menuItemId as string;
		const signature = optionsSignature(line.selectedOptions);
		const primary = primarySignature.get(dish);
		let key: string;
		if (primary === undefined) {
			primarySignature.set(dish, signature);
			key = dish;
		} else {
			key = primary === signature ? dish : variantPickKey(dish, line.selectedOptions);
		}
		const existing = picks.get(key);
		if (existing) {
			picks.set(key, { ...existing, quantity: existing.quantity + line.quantity });
		} else {
			picks.set(key, {
				menuItemId: line.menuItemId,
				quantity: line.quantity,
				basePrice: line.unitPrice,
				selectedOptions: toOptionMap(line.selectedOptions),
			});
		}
	}
	return picks;
}

/**
 * One pick per dish, for the dish cards: the dish's own pick with the quantity
 * of every way it is ordered, so a card never under-reports what is coming.
 */
export function picksByDish(picks: ReadonlyMap<string, MenuPick>): Map<string, MenuPick> {
	const byDish = new Map<string, MenuPick>();
	for (const [key, pick] of picks) {
		const dish = pick.menuItemId as string;
		const seen = byDish.get(dish);
		if (!seen) {
			byDish.set(dish, pick);
		} else if (key === dish) {
			byDish.set(dish, { ...pick, quantity: pick.quantity + seen.quantity });
		} else {
			byDish.set(dish, { ...seen, quantity: seen.quantity + pick.quantity });
		}
	}
	return byDish;
}
