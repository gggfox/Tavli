import { getMaterialStatusConfig } from "@/features/materials/constants";
import { StatusBadge } from "@/global";
import { isValidTimestamp } from "@/global/utils/date";
import { createColumnHelper } from "@tanstack/react-table";
import type { MaterialDoc } from "convex/constants";
import { IndeterminateCheckbox } from "./IndeterminateCheckbox.tsx";

type MaterialAggregate = MaterialDoc;
const columnHelper = createColumnHelper<MaterialAggregate>();

function formatDate(timestamp: number | undefined): string {
	if (!isValidTimestamp(timestamp)) {
		return "—";
	}
	return new Intl.DateTimeFormat("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(timestamp));
}

function formatQuantity(normalizedQuantity: MaterialAggregate["normalizedQuantity"]): string {
	const { quantity, unit } = normalizedQuantity;
	return `${quantity.toLocaleString()} ${unit}`;
}

export const columns = [
	columnHelper.display({
		id: "select",
		header: ({ table }) => (
			<IndeterminateCheckbox
				checked={table.getIsAllPageRowsSelected()}
				indeterminate={table.getIsSomePageRowsSelected()}
				onChange={(checked) => table.toggleAllPageRowsSelected(checked)}
				className="w-4 h-4 rounded cursor-pointer accent-emerald-600"
				aria-label="Select all rows"
			/>
		),
		cell: ({ row }) => (
			<IndeterminateCheckbox
				checked={row.getIsSelected()}
				disabled={!row.getCanSelect()}
				onChange={(checked) => row.toggleSelected(checked)}
				className="w-4 h-4 rounded cursor-pointer accent-emerald-600"
				aria-label="Select row"
			/>
		),
		enableSorting: false,
		enableHiding: false,
	}),
	columnHelper.accessor("materialId", {
		header: "Material ID",
		cell: (info) => (
			<span className="font-mono text-xs" style={{ color: "var(--text-primary)" }}>
				{info.getValue().slice(0, 16)}...
			</span>
		),
	}),
	columnHelper.accessor("location", {
		header: "Location",
		cell: (info) => (
			<span className="text-sm" style={{ color: "var(--text-primary)" }}>
				{info.getValue()}
			</span>
		),
	}),
	columnHelper.accessor("normalizedQuantity", {
		header: "Quantity",
		cell: (info) => (
			<span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
				{formatQuantity(info.getValue())}
			</span>
		),
	}),
	columnHelper.accessor("sellerId", {
		header: "Seller",
		cell: (info) => (
			<span className="font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
				{info.getValue().slice(0, 12)}...
			</span>
		),
	}),
	columnHelper.accessor("status", {
		header: "Status",
		cell: (info) => {
			const status = info.getValue();
			const config = getMaterialStatusConfig(status);
			return (
				<StatusBadge bgColor={config.bgColor} textColor={config.textColor} label={config.label} />
			);
		},
	}),
	columnHelper.accessor("createdAt", {
		header: "Submitted",
		cell: (info) => (
			<span className="text-sm" style={{ color: "var(--text-secondary)" }}>
				{formatDate(info.getValue())}
			</span>
		),
	}),
];
