/**
 * Layout rules for the diner menu that are worth testing on their own.
 */

/**
 * Is this item on the menu today?
 *
 * One predicate for every surface that counts or lists items — the section
 * body, the category rail's counts, the full-menu sheet — so a dish switched
 * off or restricted to weekends disappears from all of them at once.
 */
export function isItemAvailableToday(
	item: Readonly<{ isAvailable: boolean; availableDays?: readonly number[] }>,
	dayOfWeek: number
): boolean {
	if (!item.isAvailable) return false;
	if (item.availableDays && item.availableDays.length > 0) {
		return item.availableDays.includes(dayOfWeek);
	}
	return true;
}

/**
 * The mixed-menu rule (prototype round 2, variant F).
 *
 * Items with a photo are rendered as image cards, the rest as compact rows —
 * within a section, cards first. Chosen over a uniform grid because on a
 * real menu most dishes have no picture, and a uniform image grid turns that
 * into a wall of placeholder tiles. As photos arrive the rows become cards
 * on their own; nothing has to be redesigned.
 */
export function partitionByPhoto<T extends { imageUrl?: string | null }>(
	items: readonly T[]
): { withPhoto: T[]; withoutPhoto: T[] } {
	const withPhoto: T[] = [];
	const withoutPhoto: T[] = [];
	for (const item of items) {
		(item.imageUrl ? withPhoto : withoutPhoto).push(item);
	}
	return { withPhoto, withoutPhoto };
}

/** Dishes on the menu today, per category — for the rail and the sheet. */
export function countAvailableByCategory(
	items: readonly {
		categoryId: string;
		isAvailable: boolean;
		availableDays?: readonly number[];
	}[],
	dayOfWeek: number
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const item of items) {
		if (!isItemAvailableToday(item, dayOfWeek)) continue;
		counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1);
	}
	return counts;
}

/**
 * Each category's tile image: the photo of its first dish in display order.
 * A category with no photographed dish is simply absent — the tile rail
 * renders an initial in its place rather than a broken image.
 */
export function firstImageByCategory(
	items: readonly { categoryId: string; imageUrl?: string | null; displayOrder: number }[]
): Map<string, string> {
	const best = new Map<string, { order: number; url: string }>();
	for (const item of items) {
		if (!item.imageUrl) continue;
		const current = best.get(item.categoryId);
		if (!current || item.displayOrder < current.order) {
			best.set(item.categoryId, { order: item.displayOrder, url: item.imageUrl });
		}
	}
	return new Map(Array.from(best, ([id, { url }]) => [id, url]));
}
