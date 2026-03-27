import { InlineError, TextInput } from "@/global/components";
import { unwrapResult } from "@/global/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Check, Pencil, Plus, ToggleLeft, ToggleRight, Trash2, X } from "lucide-react";
import { useState } from "react";

interface TablesManagerProps {
	restaurantId: Id<"restaurants">;
}

export function TablesManager({ restaurantId }: Readonly<TablesManagerProps>) {
	const { data: tables } = useQuery(convexQuery(api.tables.getByRestaurant, { restaurantId }));

	const createTable = useMutation({
		mutationFn: useConvexMutation(api.tables.create),
	});
	const updateTable = useMutation({
		mutationFn: useConvexMutation(api.tables.update),
	});
	const toggleActive = useMutation({
		mutationFn: useConvexMutation(api.tables.toggleActive),
	});
	const removeTable = useMutation({
		mutationFn: useConvexMutation(api.tables.remove),
	});

	const [newTableNumber, setNewTableNumber] = useState("");
	const [newTableLabel, setNewTableLabel] = useState("");
	const [editingId, setEditingId] = useState<Id<"tables"> | null>(null);
	const [editNumber, setEditNumber] = useState("");
	const [editLabel, setEditLabel] = useState("");
	const [error, setError] = useState<string | null>(null);

	const clearError = () => setError(null);

	const handleAdd = async (e: React.FormEvent) => {
		e.preventDefault();
		clearError();
		const num = Number.parseInt(newTableNumber, 10);
		if (Number.isNaN(num)) return;
		try {
			unwrapResult(
				await createTable.mutateAsync({
					restaurantId,
					tableNumber: num,
					label: newTableLabel || undefined,
				})
			);
			setNewTableNumber("");
			setNewTableLabel("");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create table");
		}
	};

	const startEdit = (tableId: Id<"tables">, tableNumber: number, label?: string) => {
		clearError();
		setEditingId(tableId);
		setEditNumber(String(tableNumber));
		setEditLabel(label ?? "");
	};

	const cancelEdit = () => {
		setEditingId(null);
		setEditNumber("");
		setEditLabel("");
	};

	const handleSaveEdit = async () => {
		if (!editingId) return;
		clearError();
		const num = Number.parseInt(editNumber, 10);
		if (Number.isNaN(num)) return;
		try {
			unwrapResult(
				await updateTable.mutateAsync({
					tableId: editingId,
					tableNumber: num,
					label: editLabel || undefined,
				})
			);
			cancelEdit();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to update table");
		}
	};

	const handleToggleActive = async (tableId: Id<"tables">) => {
		clearError();
		try {
			unwrapResult(await toggleActive.mutateAsync({ tableId }));
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to toggle table status");
		}
	};

	const handleRemove = async (tableId: Id<"tables">) => {
		clearError();
		try {
			unwrapResult(await removeTable.mutateAsync({ tableId }));
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to remove table");
		}
	};

	const sorted = [...(tables ?? [])].sort((a, b) => a.tableNumber - b.tableNumber);

	return (
		<div className="space-y-6">
			{error && <InlineError message={error} onDismiss={clearError} />}

			<form onSubmit={handleAdd} className="flex gap-3 items-end">
				<TextInput
					id="new-table-number"
					label="Table #"
					type="number"
					value={newTableNumber}
					onChange={(e) => setNewTableNumber(e.target.value)}
					required
					min={1}
					className="w-20"
				/>
				<TextInput
					id="new-table-label"
					label="Label (optional)"
					type="text"
					value={newTableLabel}
					onChange={(e) => setNewTableLabel(e.target.value)}
					placeholder="Patio 3"
					className="w-40"
				/>
				<button
					type="submit"
					className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
				>
					<Plus size={16} />
					Add
				</button>
			</form>

			<div className="space-y-2">
				{sorted.map((table) => (
					<div
						key={table._id}
						className="flex items-center justify-between px-4 py-3 rounded-lg"
						style={{
							backgroundColor: "var(--bg-secondary)",
							border: "1px solid var(--border-default)",
						}}
					>
						{editingId === table._id ? (
							<div className="flex items-center gap-3 flex-1 mr-3">
								<TextInput
									type="number"
									value={editNumber}
									onChange={(e) => setEditNumber(e.target.value)}
									min={1}
									className="w-20"
								/>
								<TextInput
									type="text"
									value={editLabel}
									onChange={(e) => setEditLabel(e.target.value)}
									placeholder="Label"
									className="w-32"
								/>
								<button
									onClick={handleSaveEdit}
									className="p-1.5 rounded-md hover:bg-[var(--bg-hover)]"
									title="Save"
								>
									<Check size={16} style={{ color: "var(--accent-success)" }} />
								</button>
								<button
									onClick={cancelEdit}
									className="p-1.5 rounded-md hover:bg-[var(--bg-hover)]"
									title="Cancel"
								>
									<X size={16} style={{ color: "var(--text-muted)" }} />
								</button>
							</div>
						) : (
							<>
								<div className="flex items-center gap-3">
									<span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
										Table {table.tableNumber}
									</span>
									{table.label && (
										<span className="text-xs" style={{ color: "var(--text-muted)" }}>
											{table.label}
										</span>
									)}
								</div>
								<div className="flex items-center gap-2">
									<button
										onClick={() => startEdit(table._id, table.tableNumber, table.label)}
										className="p-1.5 rounded-md hover:bg-[var(--bg-hover)]"
										title="Edit table"
									>
										<Pencil size={16} style={{ color: "var(--text-secondary)" }} />
									</button>
									<button
										onClick={() => handleToggleActive(table._id)}
										className="p-1.5 rounded-md hover:bg-[var(--bg-hover)]"
										title={table.isActive ? "Deactivate" : "Activate"}
									>
										{table.isActive ? (
											<ToggleRight size={20} style={{ color: "var(--accent-success)" }} />
										) : (
											<ToggleLeft size={20} style={{ color: "var(--text-muted)" }} />
										)}
									</button>
									<button
										onClick={() => handleRemove(table._id)}
										className="p-1.5 rounded-md hover:bg-[var(--bg-hover)]"
										title="Remove table"
									>
										<Trash2 size={16} style={{ color: "var(--accent-danger)" }} />
									</button>
								</div>
							</>
						)}
					</div>
				))}
				{sorted.length === 0 && (
					<p className="text-sm py-4 text-center" style={{ color: "var(--text-muted)" }}>
						No tables yet. Add your first table above.
					</p>
				)}
			</div>
		</div>
	);
}
