import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";

export function SortIcon({
	column,
}: Readonly<{ column: { getIsSorted: () => false | "asc" | "desc" } }>) {
	const sorted = column.getIsSorted();
	if (sorted === false) {
		return <ChevronsUpDown size={14} className="text-faint-foreground"  />;
	}
	return sorted === "asc" ? (
		<ChevronUp size={14} className="text-foreground"  />
	) : (
		<ChevronDown size={14} className="text-foreground"  />
	);
}
