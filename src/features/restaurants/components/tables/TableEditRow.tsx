import { TextInput } from "@/global/components";
import { Check, X } from "lucide-react";
import { useState } from "react";
import type { Doc } from "convex/_generated/dataModel";

interface TableEditRowProps {
	table: Doc<"tables">;
	onSubmit: (next: { tableNumber: number; capacity: number | undefined }) => void;
	onCancel: () => void;
	labels: {
		numberLabel: string;
		seatsLabel: string;
		save: string;
		cancel: string;
	};
}

/**
 * Inline editor for a single table row. Mounted only while editing this
 * table; the parent uses the table id as the key so each invocation starts
 * from fresh local state pre-filled with the row's current values.
 */
export function TableEditRow({ table, onSubmit, onCancel, labels }: Readonly<TableEditRowProps>) {
	const [numberRaw, setNumberRaw] = useState<string>(String(table.tableNumber));
	const [capacityRaw, setCapacityRaw] = useState<string>(
		table.capacity !== undefined ? String(table.capacity) : ""
	);

	const submit = () => {
		const num = Number.parseInt(numberRaw, 10);
		if (Number.isNaN(num)) return;
		const cap = Number.parseInt(capacityRaw, 10);
		onSubmit({
			tableNumber: num,
			capacity: Number.isNaN(cap) ? undefined : cap,
		});
	};

	return (
		<div className="flex items-center justify-between px-4 py-3 rounded-lg bg-muted border border-border">
			<div className="flex flex-wrap items-end gap-2 flex-1 mr-3">
				{/*
				 * Both fields carry a rendered label: a bare pair of number boxes
				 * gives no clue which one is the table number and which the seats,
				 * and a placeholder disappears the moment a value is typed.
				 */}
				<TextInput
					id={`table-number-${table._id}`}
					type="number"
					label={labels.numberLabel}
					value={numberRaw}
					onChange={(e) => setNumberRaw(e.target.value)}
					min={1}
					className="w-20"
				/>
				<TextInput
					id={`table-seats-${table._id}`}
					type="number"
					label={labels.seatsLabel}
					value={capacityRaw}
					onChange={(e) => setCapacityRaw(e.target.value)}
					min={1}
					className="w-20"
				/>
				<button
					onClick={submit}
					className="p-1.5 rounded-md hover:bg-hover text-success"
					title={labels.save}
					aria-label={labels.save}
				>
					<Check size={16} />
				</button>
				<button
					onClick={onCancel}
					className="p-1.5 rounded-md hover:bg-hover text-faint-foreground"
					title={labels.cancel}
					aria-label={labels.cancel}
				>
					<X size={16} />
				</button>
			</div>
		</div>
	);
}
