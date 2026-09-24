/**
 * Bulk selection in the menu editor. Items are selected by clicking the row
 * (the row tints; there are no checkboxes), Shift+click extends from the last
 * clicked item, and a section header selects or clears its whole section.
 */

/**
 * The next selection after a click on `id`.
 *
 * A plain click toggles `id`. A Shift+click with an anchor in `orderedIds`
 * sets every item between the anchor and `id` (inclusive) to the state the
 * clicked item is moving to, so Shift+clicking a selected item clears a range.
 * `orderedIds` is the visible order across all sections, so a range can span
 * sections.
 */
export function toggleSelection<T extends string>(
	prev: ReadonlySet<T>,
	id: T,
	orderedIds: readonly T[],
	anchor: T | null,
	shiftKey: boolean
): Set<T> {
	const next = new Set(prev);
	const on = !prev.has(id);
	if (shiftKey && anchor !== null && anchor !== id) {
		const a = orderedIds.indexOf(anchor);
		const b = orderedIds.indexOf(id);
		if (a !== -1 && b !== -1) {
			for (const rid of orderedIds.slice(Math.min(a, b), Math.max(a, b) + 1)) {
				if (on) next.add(rid);
				else next.delete(rid);
			}
			return next;
		}
	}
	if (on) next.add(id);
	else next.delete(id);
	return next;
}

/** Select every id in `ids`, or clear them all when they are already all selected. */
export function toggleSection<T extends string>(prev: ReadonlySet<T>, ids: readonly T[]): Set<T> {
	const next = new Set(prev);
	const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
	for (const id of ids) {
		if (allSelected) next.delete(id);
		else next.add(id);
	}
	return next;
}

export type SectionSelectionState = "none" | "some" | "all";

export function sectionSelectionState<T extends string>(
	selected: ReadonlySet<T>,
	ids: readonly T[]
): { state: SectionSelectionState; count: number } {
	const count = ids.filter((id) => selected.has(id)).length;
	if (count === 0) return { state: "none", count };
	return { state: count === ids.length ? "all" : "some", count };
}
