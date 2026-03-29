import { CollapsibleCard, InlineEditInput, LanguageTabBar } from "@/global/components";
import { Languages } from "@/global/i18n/locales";
import { formatCents, parseDollarsToCents } from "@/global/utils/money";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useOptionGroups } from "../hooks/useOptionGroups";

interface OptionGroupManagerProps {
	restaurantId: Id<"restaurants">;
}

export function OptionGroupManager({ restaurantId }: Readonly<OptionGroupManagerProps>) {
	const {
		groups,
		createGroup,
		updateGroup,
		deleteGroup,
		createOption,
		updateOption,
		deleteOption,
	} = useOptionGroups(restaurantId);

	const { data: menus } = useQuery(
		convexQuery(api.menus.getMenusByRestaurant, restaurantId ? { restaurantId } : "skip")
	);
	const { defaultLang, supportedLangs } = useMemo(() => {
		const allMenus = menus ?? [];
		const first = allMenus[0];
		const def = first?.defaultLanguage ?? Languages.EN;
		const langSet = new Set<string>([def]);
		for (const m of allMenus) {
			for (const l of m.supportedLanguages ?? []) langSet.add(l);
		}
		return { defaultLang: def, supportedLangs: Array.from(langSet) };
	}, [menus]);

	const [selectedLang, setSelectedLang] = useState(defaultLang);
	const isTranslationMode = selectedLang !== defaultLang;

	const [showForm, setShowForm] = useState(false);

	const createGroupForm = useForm({
		defaultValues: {
			name: "",
			selType: "single" as "single" | "multi",
			isRequired: false,
		},
		onSubmit: async ({ value }) => {
			if (!value.name.trim()) return;
			await createGroup({
				restaurantId,
				name: value.name.trim(),
				selectionType: value.selType,
				isRequired: value.isRequired,
				minSelections: value.isRequired ? 1 : 0,
				maxSelections: value.selType === "single" ? 1 : 10,
			});
			createGroupForm.reset();
			setShowForm(false);
		},
	});

	const sorted = [...groups].sort((a, b) => a.displayOrder - b.displayOrder);

	return (
		<div className="space-y-6">
			<LanguageTabBar
				languages={supportedLangs}
				defaultLanguage={defaultLang}
				selectedLanguage={selectedLang}
				onSelect={setSelectedLang}
			/>

			{isTranslationMode && (
				<p className="text-xs" style={{ color: "var(--text-muted)" }}>
					Translating option group and option names. Configuration and prices are shared across all
					languages.
				</p>
			)}

			{!isTranslationMode &&
				(!showForm ? (
					<button
						onClick={() => setShowForm(true)}
						className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
					>
						<Plus size={16} /> New Option Group
					</button>
				) : (
					<form
						onSubmit={(e) => {
							e.preventDefault();
							e.stopPropagation();
							createGroupForm.handleSubmit();
						}}
						className="space-y-3 p-4 rounded-lg"
						style={{
							backgroundColor: "var(--bg-secondary)",
							border: "1px solid var(--border-default)",
						}}
					>
						<createGroupForm.Field
							name="name"
							children={(field) => (
								<input
									type="text"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									placeholder='Group name (e.g. "Meat Doneness")'
									required
									className="w-full px-3 py-2 rounded-lg text-sm"
									style={{
										backgroundColor: "var(--bg-primary)",
										border: "1px solid var(--border-default)",
										color: "var(--text-primary)",
									}}
								/>
							)}
						/>
						<div className="flex gap-4 items-center">
							<label
								className="flex items-center gap-2 text-sm"
								style={{ color: "var(--text-secondary)" }}
							>
								<createGroupForm.Field
									name="selType"
									children={(field) => (
										<select
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value as "single" | "multi")}
											className="px-2 py-1 rounded text-sm"
											style={{
												backgroundColor: "var(--bg-primary)",
												border: "1px solid var(--border-default)",
												color: "var(--text-primary)",
											}}
										>
											<option value="single">Single select</option>
											<option value="multi">Multi select</option>
										</select>
									)}
								/>
							</label>
							<label
								className="flex items-center gap-2 text-sm"
								style={{ color: "var(--text-secondary)" }}
							>
								<createGroupForm.Field
									name="isRequired"
									children={(field) => (
										<input
											type="checkbox"
											checked={field.state.value}
											onChange={(e) => field.handleChange(e.target.checked)}
										/>
									)}
								/>
								Required
							</label>
						</div>
						<div className="flex gap-2">
							<button
								type="submit"
								className="px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
							>
								Create
							</button>
							<button
								type="button"
								onClick={() => setShowForm(false)}
								className="px-4 py-2 rounded-lg text-sm hover-btn-secondary"
							>
								Cancel
							</button>
						</div>
					</form>
				))}

			{sorted.map((group) => (
				<GroupCard
					key={group._id}
					group={group}
					restaurantId={restaurantId}
					onDelete={() => deleteGroup({ groupId: group._id })}
					onUpdateGroup={updateGroup}
					onCreateOption={createOption}
					onUpdateOption={updateOption}
					onDeleteOption={deleteOption}
					selectedLang={isTranslationMode ? selectedLang : undefined}
				/>
			))}
		</div>
	);
}

function GroupCard({
	group,
	restaurantId,
	onDelete,
	onUpdateGroup,
	onCreateOption,
	onUpdateOption,
	onDeleteOption,
	selectedLang,
}: Readonly<{
	group: Doc<"optionGroups">;
	restaurantId: Id<"restaurants">;
	onDelete: () => void;
	onUpdateGroup: (args: { groupId: Id<"optionGroups">; name?: string }) => Promise<unknown>;
	onCreateOption: (args: {
		optionGroupId: Id<"optionGroups">;
		restaurantId: Id<"restaurants">;
		name: string;
		priceModifier: number;
	}) => Promise<unknown>;
	onUpdateOption: (args: {
		optionId: Id<"options">;
		name?: string;
		priceModifier?: number;
	}) => Promise<unknown>;
	onDeleteOption: (args: { optionId: Id<"options"> }) => Promise<unknown>;
	selectedLang?: string;
}>) {
	const isTranslating = !!selectedLang;
	const [expanded, setExpanded] = useState(false);
	const { data: options } = useQuery(
		convexQuery(api.optionGroups.getOptionsByGroup, { optionGroupId: group._id })
	);
	const setGroupTranslation = useMutation({
		mutationFn: useConvexMutation(api.optionGroups.setGroupTranslation),
	});
	const setOptionTranslation = useMutation({
		mutationFn: useConvexMutation(api.optionGroups.setOptionTranslation),
	});

	const addOptionForm = useForm({
		defaultValues: { name: "", price: "0" },
		onSubmit: async ({ value }) => {
			if (!value.name.trim()) return;
			await onCreateOption({
				optionGroupId: group._id,
				restaurantId,
				name: value.name.trim(),
				priceModifier: parseDollarsToCents(value.price) || 0,
			});
			addOptionForm.reset();
		},
	});

	const headerContent = isTranslating ? (
		<>
			<span className="text-sm shrink-0" style={{ color: "var(--text-muted)" }}>
				{group.name} &rarr;
			</span>
			<InlineEditInput
				value={group.translations?.[selectedLang]?.name ?? ""}
				placeholder={`${group.name} translation...`}
				onSave={(val) =>
					setGroupTranslation.mutateAsync({
						groupId: group._id,
						lang: selectedLang,
						name: val,
					})
				}
			/>
			{!group.translations?.[selectedLang]?.name && (
				<AlertTriangle size={14} className="shrink-0" style={{ color: "var(--accent-warning)" }} />
			)}
		</>
	) : (
		<>
			<InlineEditInput
				value={group.name}
				placeholder="Group name"
				onSave={(val) => onUpdateGroup({ groupId: group._id, name: val })}
				className="text-sm font-medium"
			/>
			<span
				className="text-xs px-2 py-0.5 rounded-full shrink-0"
				style={{ backgroundColor: "var(--bg-primary)", color: "var(--text-muted)" }}
			>
				{group.selectionType === "single" ? "Single" : "Multi"}{" "}
				{group.isRequired ? "• Required" : "• Optional"}
			</span>
		</>
	);

	return (
		<CollapsibleCard
			expanded={expanded}
			onToggle={() => setExpanded(!expanded)}
			headerContent={headerContent}
			headerActions={
				!isTranslating ? (
					<button
						onClick={(e) => {
							e.stopPropagation();
							onDelete();
						}}
						className="p-1 rounded hover:bg-[var(--bg-hover)]"
					>
						<Trash2 size={14} style={{ color: "var(--accent-danger)" }} />
					</button>
				) : undefined
			}
		>
			{(options ?? []).map((opt) => {
				if (isTranslating) {
					const translated = opt.translations?.[selectedLang]?.name ?? "";
					return (
						<div
							key={opt._id}
							className="flex items-center gap-3 px-3 py-2 rounded"
							style={{
								backgroundColor: "var(--bg-primary)",
								border: !translated ? "1px solid var(--accent-warning)" : "1px solid transparent",
							}}
						>
							<span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>
								{opt.name} &rarr;
							</span>
							<InlineEditInput
								value={translated}
								placeholder={`${opt.name} translation...`}
								onSave={(val) =>
									setOptionTranslation.mutateAsync({
										optionId: opt._id,
										lang: selectedLang,
										name: val,
									})
								}
							/>
							{opt.priceModifier > 0 && (
								<span className="text-xs shrink-0" style={{ color: "var(--accent-success)" }}>
									+${formatCents(opt.priceModifier)}
								</span>
							)}
							{!translated && (
								<AlertTriangle
									size={14}
									className="shrink-0"
									style={{ color: "var(--accent-warning)" }}
								/>
							)}
						</div>
					);
				}
				return (
					<div
						key={opt._id}
						className="flex items-center gap-3 px-3 py-2 rounded"
						style={{ backgroundColor: "var(--bg-primary)" }}
					>
						<InlineEditInput
							value={opt.name}
							placeholder="Option name"
							onSave={(val) => onUpdateOption({ optionId: opt._id, name: val })}
							className="text-sm"
						/>
						<InlineEditInput
							value={formatCents(opt.priceModifier)}
							placeholder="0"
							onSave={(val) =>
								onUpdateOption({
									optionId: opt._id,
									priceModifier: parseDollarsToCents(val) || 0,
								})
							}
							className="text-sm w-20 shrink-0"
							inputMode="decimal"
							prefix="$"
						/>
						<button
							onClick={() => onDeleteOption({ optionId: opt._id })}
							className="p-1 rounded hover:bg-[var(--bg-hover)] shrink-0"
						>
							<Trash2 size={14} style={{ color: "var(--accent-danger)" }} />
						</button>
					</div>
				);
			})}
			{!isTranslating && (
				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						addOptionForm.handleSubmit();
					}}
					className="flex gap-2 pt-2"
				>
					<addOptionForm.Field
						name="name"
						children={(field) => (
							<input
								type="text"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								placeholder="Option name"
								required
								className="flex-1 px-2 py-1.5 rounded text-sm"
								style={{
									backgroundColor: "var(--bg-secondary)",
									border: "1px solid var(--border-default)",
									color: "var(--text-primary)",
								}}
							/>
						)}
					/>
					<addOptionForm.Field
						name="price"
						children={(field) => (
							<input
								type="number"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								placeholder="+$"
								step="0.01"
								min="0"
								className="w-20 px-2 py-1.5 rounded text-sm"
								style={{
									backgroundColor: "var(--bg-secondary)",
									border: "1px solid var(--border-default)",
									color: "var(--text-primary)",
								}}
							/>
						)}
					/>
					<button
						type="submit"
						className="px-3 py-1.5 rounded text-sm font-medium hover-btn-primary"
					>
						<Plus size={14} />
					</button>
				</form>
			)}
		</CollapsibleCard>
	);
}
