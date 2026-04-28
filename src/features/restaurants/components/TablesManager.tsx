import { InlineError, TextInput } from "@/global/components";
import { unwrapResult } from "@/global/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useForm } from "@tanstack/react-form";
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

	const [editingId, setEditingId] = useState<Id<"tables"> | null>(null);
	const [error, setError] = useState<string | null>(null);

	const clearError = () => setError(null);

	const createForm = useForm({
		defaultValues: { tableNumber: "", label: "", capacity: "4" },
		onSubmit: async ({ value }) => {
			clearError();
			const num = Number.parseInt(value.tableNumber, 10);
			if (Number.isNaN(num)) return;
			const cap = Number.parseInt(value.capacity, 10);
			try {
				unwrapResult(
					await createTable.mutateAsync({
						restaurantId,
						tableNumber: num,
						label: value.label || undefined,
						capacity: Number.isNaN(cap) ? undefined : cap,
					})
				);
				createForm.reset();
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to create table");
			}
		},
	});

	const editForm = useForm({
		defaultValues: { editNumber: "", editLabel: "", editCapacity: "" },
		onSubmit: async ({ value }) => {
			if (!editingId) return;
			clearError();
			const num = Number.parseInt(value.editNumber, 10);
			if (Number.isNaN(num)) return;
			const cap = Number.parseInt(value.editCapacity, 10);
			try {
				unwrapResult(
					await updateTable.mutateAsync({
						tableId: editingId,
						tableNumber: num,
						label: value.editLabel || undefined,
						capacity: Number.isNaN(cap) ? undefined : cap,
					})
				);
				cancelEdit();
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to update table");
			}
		},
	});

	const startEdit = (
		tableId: Id<"tables">,
		tableNumber: number,
		label?: string,
		capacity?: number
	) => {
		clearError();
		setEditingId(tableId);
		editForm.reset({
			editNumber: String(tableNumber),
			editLabel: label ?? "",
			editCapacity: capacity !== undefined ? String(capacity) : "",
		});
	};

	const cancelEdit = () => {
		setEditingId(null);
		editForm.reset();
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

			<form
				onSubmit={(e) => {
					e.preventDefault();
					e.stopPropagation();
					createForm.handleSubmit();
				}}
				className="flex gap-3 items-end"
			>
				<createForm.Field
					name="tableNumber"
					children={(field) => (
						<TextInput
							id="new-table-number"
							label="Table #"
							type="number"
							value={field.state.value}
							onChange={(e) => field.handleChange(e.target.value)}
							onBlur={field.handleBlur}
							required
							min={1}
							className="w-20"
						/>
					)}
				/>
				<createForm.Field
					name="label"
					children={(field) => (
						<TextInput
							id="new-table-label"
							label="Label (optional)"
							type="text"
							value={field.state.value}
							onChange={(e) => field.handleChange(e.target.value)}
							onBlur={field.handleBlur}
							placeholder="Patio 3"
							className="w-40"
						/>
					)}
				/>
				<createForm.Field
					name="capacity"
					children={(field) => (
						<TextInput
							id="new-table-capacity"
							label="Seats"
							type="number"
							value={field.state.value}
							onChange={(e) => field.handleChange(e.target.value)}
							onBlur={field.handleBlur}
							required
							min={1}
							className="w-20"
						/>
					)}
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
								<editForm.Field
									name="editNumber"
									children={(field) => (
										<TextInput
											type="number"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											min={1}
											className="w-20"
										/>
									)}
								/>
								<editForm.Field
									name="editLabel"
									children={(field) => (
										<TextInput
											type="text"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder="Label"
											className="w-32"
										/>
									)}
								/>
								<editForm.Field
									name="editCapacity"
									children={(field) => (
										<TextInput
											type="number"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder="Seats"
											min={1}
											className="w-20"
										/>
									)}
								/>
								<button
									onClick={() => editForm.handleSubmit()}
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
									<span className="text-xs" style={{ color: "var(--text-muted)" }}>
										{table.capacity !== undefined
											? `${table.capacity} seats`
											: "seats not set"}
									</span>
								</div>
								<div className="flex items-center gap-2">
									<button
										onClick={() =>
											startEdit(table._id, table.tableNumber, table.label, table.capacity)
										}
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
