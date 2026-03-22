/**
 * MultiCardSelect Component
 * A multi-select component that displays options as selectable cards in a grid layout
 * with icons, grouping, and comprehensive keyboard navigation.
 * Groups are displayed in columns with 2 groups per column.
 */
import { useRef } from "react";
import { Label } from "./Label";
import { OptionList } from "./OptionList";
import { SelectedCount } from "./SelectedCount";

interface MultiCardSelectProps<T extends { _id: string; name: string; icon?: string }> {
	label: string;
	options: T[];
	selectedIds: string[];
	onChange: (ids: string[]) => void;
	placeholder?: string;
	required?: boolean;
	groupBy?: (item: T) => string;
}

export function MultiCardSelect<T extends { _id: string; name: string; icon?: string }>({
	label,
	options,
	selectedIds,
	onChange,
	required = false,
	groupBy,
}: Readonly<MultiCardSelectProps<T>>) {
	const containerRef = useRef<HTMLDivElement>(null);
	const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);

	return (
		<div className="space-y-3" ref={containerRef}>
			<Label label={label} required={required} />
			<OptionList
				options={options}
				groupBy={groupBy || (() => "")}
				selectedIds={selectedIds}
				cardRefs={cardRefs}
				onChange={onChange}
			/>
			<SelectedCount selectedIds={selectedIds} />
		</div>
	);
}
