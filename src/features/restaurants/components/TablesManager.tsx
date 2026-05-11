import { InlineError, TextInput } from "@/global/components";
import { RestaurantsKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { Check, Pencil, Plus, ToggleLeft, ToggleRight, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

interface TablesManagerProps {
	restaurantId: Id<"restaurants">;
}

export function TablesManager({ restaurantId }: Readonly<TablesManagerProps>) {
	const { t } = useTranslation();
	const { data: tables } = useQuery(convexQuery(api.tables.getByRestaurant, { restaurantId }));
	const { data: sections } = useQuery(
		convexQuery(api.sections.getByRestaurant, { restaurantId })
	);

	const createTable = useMutation({ mutationFn: useConvexMutation(api.tables.create) });
	const updateTable = useMutation({ mutationFn: useConvexMutation(api.tables.update) });
	const toggleActive = useMutation({ mutationFn: useConvexMutation(api.tables.toggleActive) });
	const removeTable = useMutation({ mutationFn: useConvexMutation(api.tables.remove) });

	const createSection = useMutation({ mutationFn: useConvexMutation(api.sections.create) });
	const updateSection = useMutation({ mutationFn: useConvexMutation(api.sections.update) });
	const removeSection = useMutation({ mutationFn: useConvexMutation(api.sections.remove) });
	const assignTableSection = useMutation({
		mutationFn: useConvexMutation(api.sections.assignTable),
	});

	const [editingId, setEditingId] = useState<Id<"tables"> | null>(null);
	const [editingSectionId, setEditingSectionId] = useState<Id<"sections"> | null>(null);
	const [error, setError] = useState<string | null>(null);

	const clearError = () => setError(null);

	const sectionsList = useMemo(() => sections ?? [], [sections]);
	const sectionLabel = (section: Doc<"sections">, fallbackIndex: number): string => {
		if (section.isSystem === true && (section.name === undefined || section.name === "Default")) {
			return t(RestaurantsKeys.SECTIONS_DEFAULT_BADGE);
		}
		if (section.name && section.name.length > 0) return section.name;
		return t(RestaurantsKeys.SECTIONS_UNNAMED, { number: fallbackIndex + 1 });
	};

	const createForm = useForm({
		defaultValues: { tableNumber: "", label: "", capacity: "4", sectionId: "" as string },
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
						sectionId:
							value.sectionId !== ""
								? (value.sectionId as Id<"sections">)
								: undefined,
					})
				);
				createForm.reset();
			} catch (err) {
				setError(err instanceof Error ? err.message : t(RestaurantsKeys.TABLES_CREATE_FAILED));
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
				setError(err instanceof Error ? err.message : t(RestaurantsKeys.TABLES_UPDATE_FAILED));
			}
		},
	});

	const newSectionForm = useForm({
		defaultValues: { name: "" },
		onSubmit: async ({ value }) => {
			clearError();
			try {
				unwrapResult(
					await createSection.mutateAsync({
						restaurantId,
						name: value.name || undefined,
					})
				);
				newSectionForm.reset();
			} catch (err) {
				setError(err instanceof Error ? err.message : t(RestaurantsKeys.SECTIONS_CREATE_FAILED));
			}
		},
	});

	const renameSectionForm = useForm({
		defaultValues: { name: "" },
		onSubmit: async ({ value }) => {
			if (!editingSectionId) return;
			clearError();
			try {
				unwrapResult(
					await updateSection.mutateAsync({
						sectionId: editingSectionId,
						name: value.name,
					})
				);
				setEditingSectionId(null);
				renameSectionForm.reset();
			} catch (err) {
				setError(err instanceof Error ? err.message : t(RestaurantsKeys.SECTIONS_UPDATE_FAILED));
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

	const startSectionEdit = (section: Doc<"sections">) => {
		clearError();
		setEditingSectionId(section._id);
		renameSectionForm.reset({ name: section.name ?? "" });
	};

	const cancelSectionEdit = () => {
		setEditingSectionId(null);
		renameSectionForm.reset();
	};

	const handleToggleActive = async (tableId: Id<"tables">) => {
		clearError();
		try {
			unwrapResult(await toggleActive.mutateAsync({ tableId }));
		} catch (err) {
			setError(err instanceof Error ? err.message : t(RestaurantsKeys.TABLES_TOGGLE_FAILED));
		}
	};

	const handleRemoveTable = async (tableId: Id<"tables">) => {
		clearError();
		try {
			unwrapResult(await removeTable.mutateAsync({ tableId }));
		} catch (err) {
			setError(err instanceof Error ? err.message : t(RestaurantsKeys.TABLES_REMOVE_FAILED));
		}
	};

	const handleRemoveSection = async (sectionId: Id<"sections">) => {
		clearError();
		try {
			unwrapResult(await removeSection.mutateAsync({ sectionId }));
		} catch (err) {
			setError(err instanceof Error ? err.message : t(RestaurantsKeys.SECTIONS_REMOVE_FAILED));
		}
	};

	const handleMoveTableToSection = async (
		tableId: Id<"tables">,
		nextSectionId: Id<"sections">
	) => {
		clearError();
		try {
			unwrapResult(
				await assignTableSection.mutateAsync({ tableId, sectionId: nextSectionId })
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : t(RestaurantsKeys.SECTIONS_ASSIGN_FAILED));
		}
	};

	const tablesBySection = useMemo(() => {
		const byId = new Map<string, Doc<"tables">[]>();
		const unassigned: Doc<"tables">[] = [];
		for (const table of tables ?? []) {
			if (table.sectionId) {
				const list = byId.get(table.sectionId) ?? [];
				list.push(table);
				byId.set(table.sectionId, list);
			} else {
				unassigned.push(table);
			}
		}
		for (const list of byId.values()) {
			list.sort((a, b) => a.tableNumber - b.tableNumber);
		}
		unassigned.sort((a, b) => a.tableNumber - b.tableNumber);
		return { byId, unassigned };
	}, [tables]);

	const renderTableRow = (table: Doc<"tables">) => (
		<div
			key={table._id}
			className="flex items-center justify-between px-4 py-3 rounded-lg bg-muted border border-border"
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
								placeholder={t(RestaurantsKeys.TABLES_LABEL_LABEL)}
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
								placeholder={t(RestaurantsKeys.TABLES_SEATS_LABEL)}
								min={1}
								className="w-20"
							/>
						)}
					/>
					<button
						onClick={() => editForm.handleSubmit()}
						className="p-1.5 rounded-md hover:bg-hover text-success"
						title={t(RestaurantsKeys.TABLES_SAVE)}
					>
						<Check size={16} />
					</button>
					<button
						onClick={cancelEdit}
						className="p-1.5 rounded-md hover:bg-hover text-faint-foreground"
						title={t(RestaurantsKeys.TABLES_CANCEL)}
					>
						<X size={16} />
					</button>
				</div>
			) : (
				<>
					<div className="flex items-center gap-3">
						<span className="text-sm font-medium text-foreground">
							{t(RestaurantsKeys.TABLES_TABLE_LABEL, { number: table.tableNumber })}
						</span>
						{table.label && (
							<span className="text-xs text-faint-foreground">{table.label}</span>
						)}
						<span className="text-xs text-faint-foreground">
							{table.capacity !== undefined
								? t(RestaurantsKeys.TABLES_SEATS_FORMAT, { count: table.capacity })
								: t(RestaurantsKeys.TABLES_SEATS_NOT_SET)}
						</span>
					</div>
					<div className="flex items-center gap-2">
						<select
							value={table.sectionId ?? ""}
							onChange={(e) =>
								handleMoveTableToSection(table._id, e.target.value as Id<"sections">)
							}
							className="px-2 py-1 rounded-md bg-background border border-border text-xs text-foreground"
							aria-label={t(RestaurantsKeys.SECTIONS_MOVE_TABLE_LABEL)}
							title={t(RestaurantsKeys.SECTIONS_MOVE_TABLE_LABEL)}
						>
							{sectionsList.map((s, idx) => (
								<option key={s._id} value={s._id}>
									{sectionLabel(s, idx)}
								</option>
							))}
						</select>
						<button
							onClick={() =>
								startEdit(table._id, table.tableNumber, table.label, table.capacity)
							}
							className="p-1.5 rounded-md hover:bg-hover text-muted-foreground"
							title={t(RestaurantsKeys.TABLES_EDIT_TITLE)}
						>
							<Pencil size={16} />
						</button>
						<button
							onClick={() => handleToggleActive(table._id)}
							className="p-1.5 rounded-md hover:bg-hover text-success"
							title={
								table.isActive
									? t(RestaurantsKeys.TABLES_DEACTIVATE_TITLE)
									: t(RestaurantsKeys.TABLES_ACTIVATE_TITLE)
							}
						>
							{table.isActive ? (
								<ToggleRight size={20} />
							) : (
								<ToggleLeft size={20} className="text-faint-foreground" />
							)}
						</button>
						<button
							onClick={() => handleRemoveTable(table._id)}
							className="p-1.5 rounded-md hover:bg-hover text-destructive"
							title={t(RestaurantsKeys.TABLES_REMOVE_TITLE)}
						>
							<Trash2 size={16} />
						</button>
					</div>
				</>
			)}
		</div>
	);

	return (
		<div className="space-y-6">
			{error && <InlineError message={error} onDismiss={clearError} />}

			<div className="space-y-3">
				<div>
					<h3 className="text-sm font-semibold text-foreground">
						{t(RestaurantsKeys.SECTIONS_HEADING)}
					</h3>
					<p className="text-xs text-faint-foreground">
						{t(RestaurantsKeys.SECTIONS_HINT)}
					</p>
				</div>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						newSectionForm.handleSubmit();
					}}
					className="flex gap-2 items-end"
				>
					<newSectionForm.Field
						name="name"
						children={(field) => (
							<TextInput
								id="new-section-name"
								type="text"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								placeholder={t(RestaurantsKeys.SECTIONS_NEW_NAME_PLACEHOLDER)}
								className="w-64"
							/>
						)}
					/>
					<button
						type="submit"
						className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium hover-btn-primary"
					>
						<Plus size={16} />
						{t(RestaurantsKeys.SECTIONS_ADD)}
					</button>
				</form>
			</div>

			<form
				onSubmit={(e) => {
					e.preventDefault();
					e.stopPropagation();
					createForm.handleSubmit();
				}}
				className="flex gap-3 items-end flex-wrap"
			>
				<createForm.Field
					name="tableNumber"
					children={(field) => (
						<TextInput
							id="new-table-number"
							label={t(RestaurantsKeys.TABLES_NUMBER_LABEL)}
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
							label={t(RestaurantsKeys.TABLES_LABEL_LABEL)}
							type="text"
							value={field.state.value}
							onChange={(e) => field.handleChange(e.target.value)}
							onBlur={field.handleBlur}
							placeholder={t(RestaurantsKeys.TABLES_LABEL_PLACEHOLDER)}
							className="w-40"
						/>
					)}
				/>
				<createForm.Field
					name="capacity"
					children={(field) => (
						<TextInput
							id="new-table-capacity"
							label={t(RestaurantsKeys.TABLES_SEATS_LABEL)}
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
					name="sectionId"
					children={(field) => (
						<label className="flex flex-col gap-1 text-xs font-medium text-faint-foreground">
							{t(RestaurantsKeys.SECTIONS_MOVE_TABLE_LABEL)}
							<select
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								className="px-3 py-2 rounded-lg bg-muted border border-border text-sm text-foreground"
							>
								<option value="">
									{t(RestaurantsKeys.SECTIONS_DEFAULT_BADGE)}
								</option>
								{sectionsList.map((s, idx) => (
									<option key={s._id} value={s._id}>
										{sectionLabel(s, idx)}
									</option>
								))}
							</select>
						</label>
					)}
				/>
				<button
					type="submit"
					className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
				>
					<Plus size={16} />
					{t(RestaurantsKeys.TABLES_ADD)}
				</button>
			</form>

			<div className="space-y-6">
				{sectionsList.map((section, sectionIdx) => {
					const tablesInSection = tablesBySection.byId.get(section._id) ?? [];
					const isDefault = section.isSystem === true;
					const isEditingThisSection = editingSectionId === section._id;
					const deleteDisabled = isDefault || tablesInSection.length > 0;
					const deleteTooltip = isDefault
						? t(RestaurantsKeys.SECTIONS_DEFAULT_DELETE_TOOLTIP)
						: tablesInSection.length > 0
							? t(RestaurantsKeys.SECTIONS_NON_EMPTY_DELETE_TOOLTIP)
							: t(RestaurantsKeys.SECTIONS_DELETE_TITLE);
					return (
						<div key={section._id} className="space-y-2">
							<div className="flex items-center gap-3">
								{isEditingThisSection ? (
									<div className="flex items-center gap-2 flex-1">
										<renameSectionForm.Field
											name="name"
											children={(field) => (
												<TextInput
													type="text"
													value={field.state.value}
													onChange={(e) => field.handleChange(e.target.value)}
													onBlur={field.handleBlur}
													placeholder={t(RestaurantsKeys.SECTIONS_RENAME_PLACEHOLDER)}
													className="w-64"
												/>
											)}
										/>
										<button
											onClick={() => renameSectionForm.handleSubmit()}
											className="p-1.5 rounded-md hover:bg-hover text-success"
											title={t(RestaurantsKeys.TABLES_SAVE)}
										>
											<Check size={16} />
										</button>
										<button
											onClick={cancelSectionEdit}
											className="p-1.5 rounded-md hover:bg-hover text-faint-foreground"
											title={t(RestaurantsKeys.TABLES_CANCEL)}
										>
											<X size={16} />
										</button>
									</div>
								) : (
									<>
										<h4 className="text-sm font-semibold text-foreground">
											{sectionLabel(section, sectionIdx)}
										</h4>
										{isDefault && (
											<span className="text-xs px-2 py-0.5 rounded-full bg-muted text-faint-foreground border border-border">
												{t(RestaurantsKeys.SECTIONS_DEFAULT_BADGE)}
											</span>
										)}
										<span className="text-xs text-faint-foreground">
											{t(RestaurantsKeys.SECTIONS_TABLE_COUNT, {
												count: tablesInSection.length,
											})}
										</span>
										<div className="ml-auto flex items-center gap-2">
											<button
												onClick={() => startSectionEdit(section)}
												className="p-1.5 rounded-md hover:bg-hover text-muted-foreground"
												title={t(RestaurantsKeys.SECTIONS_RENAME_TITLE)}
											>
												<Pencil size={14} />
											</button>
											<button
												onClick={() => handleRemoveSection(section._id)}
												className="p-1.5 rounded-md hover:bg-hover text-destructive disabled:opacity-30 disabled:cursor-not-allowed"
												title={deleteTooltip}
												disabled={deleteDisabled}
											>
												<Trash2 size={14} />
											</button>
										</div>
									</>
								)}
							</div>

							{tablesInSection.length === 0 ? (
								<p className="text-xs px-4 py-3 rounded-lg bg-muted/30 text-faint-foreground">
									{t(RestaurantsKeys.TABLES_EMPTY)}
								</p>
							) : (
								<div className="space-y-2">
									{tablesInSection.map((table) => renderTableRow(table))}
								</div>
							)}
						</div>
					);
				})}

				{tablesBySection.unassigned.length > 0 && (
					<div className="space-y-2">
						<h4 className="text-sm font-semibold text-foreground">
							{t(RestaurantsKeys.SECTIONS_DEFAULT_BADGE)}
						</h4>
						<div className="space-y-2">
							{tablesBySection.unassigned.map((table) => renderTableRow(table))}
						</div>
					</div>
				)}

				{(tables ?? []).length === 0 && (
					<p className="text-sm py-4 text-center text-faint-foreground">
						{t(RestaurantsKeys.TABLES_EMPTY)}
					</p>
				)}
			</div>
		</div>
	);
}

