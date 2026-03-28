import type { SelectedOption } from "./types";

/**
 * Computes the next set of selected options after toggling one option,
 * handling both single-select (radio) and multi-select (checkbox) groups.
 */
export function toggleOptionSelection(
	current: SelectedOption[],
	newOption: SelectedOption,
	selectionType: "single" | "multi"
): SelectedOption[] {
	const isSelected = current.some((s) => s.optionId === newOption.optionId);

	if (selectionType === "single") {
		return isSelected ? [] : [newOption];
	}

	if (isSelected) {
		return current.filter((s) => s.optionId !== newOption.optionId);
	}
	return [...current, newOption];
}
