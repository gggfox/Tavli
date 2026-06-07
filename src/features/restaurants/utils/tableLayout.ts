export const DEFAULT_CAPACITY = 4;
export const MAX_INITIAL_TABLE_COUNT = 50;
export const SECTION_DRAG_PREFIX = "section";
export const TABLE_DRAG_PREFIX = "table";
export const SECTION_DROP_PREFIX = "section-drop";

export const COLS_GRID_CLASS: Record<1 | 2 | 3, string> = {
	1: "grid gap-4 grid-cols-1",
	2: "grid gap-4 grid-cols-1 md:grid-cols-2",
	3: "grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
};

// 1, 2, 3 sections → matching column count. 4 sections look better as 2×2,
// 5+ stays at 3 columns and wraps. Since the system Default is gone, every
// section participates in the count.
export function gridColumnsForCount(count: number): 1 | 2 | 3 {
	if (count <= 1) return 1;
	if (count === 2) return 2;
	if (count === 4) return 2;
	return 3;
}

export function formatRemaining(ms: number): string {
	if (ms <= 0) return "0m";
	const totalMinutes = Math.floor(ms / 60_000);
	if (totalMinutes < 60) return `${totalMinutes}m`;
	const hours = Math.floor(totalMinutes / 60);
	if (hours < 48) return `${hours}h`;
	const days = Math.floor(hours / 24);
	return `${days}d`;
}

export function sectionDragId(sectionId: string): string {
	return `${SECTION_DRAG_PREFIX}:${sectionId}`;
}

export function sectionDropId(sectionId: string): string {
	return `${SECTION_DROP_PREFIX}:${sectionId}`;
}

export function tableDragId(tableId: string): string {
	return `${TABLE_DRAG_PREFIX}:${tableId}`;
}
