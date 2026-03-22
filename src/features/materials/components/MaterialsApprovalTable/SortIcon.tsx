import { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

interface SortIconProps<TData> {
	readonly column: Column<TData, unknown>;
}

export function SortIcon<TData>({ column }: SortIconProps<TData>) {
	const sorted = column.getIsSorted();

	if (!sorted) {
		return <ArrowUpDown size={14} style={{ color: "var(--text-muted)" }} />;
	}

	if (sorted === "asc") {
		return <ArrowUp size={14} style={{ color: "var(--accent-primary)" }} />;
	}

	return <ArrowDown size={14} style={{ color: "var(--accent-primary)" }} />;
}



