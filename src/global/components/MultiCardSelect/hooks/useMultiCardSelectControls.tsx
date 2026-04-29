import { useCallback, useMemo } from "react";
import { KEY } from "@/global/utils/keyboard";

interface UseMultiCardSelectControlsProps<T extends { _id: string; name: string; icon?: string }> {
	options: T[];
	groupBy: (item: T) => string;
	selectedIds: string[];
	onChange: (ids: string[]) => void;
	cardRefs: React.RefObject<(HTMLButtonElement | null)[]>;
}

type UseMultiCardSelectControlsReturn<T extends { _id: string; name: string; icon?: string }> = {
	groupedOptions: Record<string, T[]>;
	flatOptions: T[];
	columnsPerRow: number;
	toggleOption: (id: string) => void;
	handleKeyDown: (e: React.KeyboardEvent, currentIndex: number) => void;
	groupEntries: Array<[string, T[]]>;
};

export function useMultiCardSelectControls<T extends { _id: string; name: string; icon?: string }>({
	options,
	groupBy,
	selectedIds,
	onChange,
	cardRefs,
}: UseMultiCardSelectControlsProps<T>): UseMultiCardSelectControlsReturn<T> {
	// Group options
	const groupedOptions = useMemo(() => {
		if (!groupBy) return { "": options };
		return options.reduce(
			(acc, opt) => {
				const group = groupBy(opt);
				if (!acc[group]) acc[group] = [];
				acc[group].push(opt);
				return acc;
			},
			{} as Record<string, T[]>
		);
	}, [options, groupBy]);

	// Flatten grouped options for keyboard navigation
	const flatOptions = useMemo(() => {
		return Object.values(groupedOptions).flat();
	}, [groupedOptions]);

	// Calculate grid dimensions (for arrow key navigation)
	const columnsPerRow = 4; // Responsive: 1 on mobile, 4 on md+

	const toggleOption = useCallback(
		(id: string) => {
			if (selectedIds.includes(id)) {
				onChange(selectedIds.filter((i) => i !== id));
			} else {
				onChange([...selectedIds, id]);
			}
		},
		[selectedIds, onChange]
	);

	// Keyboard navigation handler
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent, currentIndex: number) => {
			if (flatOptions.length === 0) return;

			let newIndex: number | null;

			switch (e.key) {
				case KEY.Home:
					e.preventDefault();
					newIndex = 0;
					break;
				case KEY.End:
					e.preventDefault();
					newIndex = flatOptions.length - 1;
					break;
				case KEY.Space:
				case KEY.Enter:
					e.preventDefault();
					if (currentIndex >= 0 && currentIndex < flatOptions.length) {
						toggleOption(flatOptions[currentIndex]._id);
					}
					return;
				default:
					return;
			}

			if (newIndex !== null && newIndex >= 0 && newIndex < flatOptions.length) {
				cardRefs.current[newIndex]?.focus();
			}
		},
		[flatOptions, toggleOption, cardRefs]
	);

	// Convert grouped options to array of [groupName, items] pairs
	// Sort by number of children (descending) - groups with more children first
	const groupEntries = useMemo(
		() =>
			Object.entries(groupedOptions).sort(
				([, itemsA], [, itemsB]) => itemsB.length - itemsA.length
			),
		[groupedOptions]
	);

	return {
		groupedOptions,
		flatOptions,
		columnsPerRow,
		toggleOption,
		handleKeyDown,
		groupEntries,
	};
}
