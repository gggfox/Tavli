import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";

export function SortIcon({
	column,
}: Readonly<{ column: { getIsSorted: () => false | "asc" | "desc" } }>) {
	// `column.getIsSorted()` is a mutating read on the TanStack Table instance,
	// so React Compiler would otherwise freeze the chevron direction.
	"use no memo";

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
