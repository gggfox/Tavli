import { LanguageTabBar } from "@/global/components";
import { Languages } from "@/global/i18n/locales";
import { formatCents, parseDollarsToCents } from "@/global/utils/money";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { AlertTriangle, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
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

	const { data: menus } = useQuery(convexQuery(api.menus.getMenusByRestaurant, { restaurantId }));
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
	const [name, setName] = useState("");
	const [selType, setSelType] = useState<"single" | "multi">("single");
	const [isRequired, setIsRequired] = useState(false);

	const handleCreate = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!name.trim()) return;
		await createGroup({
			restaurantId,
			name: name.trim(),
			selectionType: selType,
			isRequired,
			minSelections: isRequired ? 1 : 0,
			maxSelections: selType === "single" ? 1 : 10,
		});
		setName("");
		setShowForm(false);
	};

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
						onSubmit={handleCreate}
						className="space-y-3 p-4 rounded-lg"
						style={{
							backgroundColor: "var(--bg-secondary)",
							border: "1px solid var(--border-default)",
						}}
					>
						<input
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder='Group name (e.g. "Meat Doneness")'
							required
							className="w-full px-3 py-2 rounded-lg text-sm"
							style={{
								backgroundColor: "var(--bg-primary)",
								border: "1px solid var(--border-default)",
								color: "var(--text-primary)",
							}}
						/>
						<div className="flex gap-4 items-center">
							<label
								className="flex items-center gap-2 text-sm"
								style={{ color: "var(--text-secondary)" }}
							>
								<select
									value={selType}
									onChange={(e) => setSelType(e.target.value as "single" | "multi")}
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
							</label>
							<label
								className="flex items-center gap-2 text-sm"
								style={{ color: "var(--text-secondary)" }}
							>
								<input
									type="checkbox"
									checked={isRequired}
									onChange={(e) => setIsRequired(e.target.checked)}
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
	const [optName, setOptName] = useState("");
	const [optPrice, setOptPrice] = useState("0");

	const handleAddOption = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!optName.trim()) return;
		await onCreateOption({
			optionGroupId: group._id,
			restaurantId,
			name: optName.trim(),
			priceModifier: parseDollarsToCents(optPrice) || 0,
		});
		setOptName("");
		setOptPrice("0");
	};

	return (
		<div
			className="rounded-lg overflow-hidden"
			style={{ border: "1px solid var(--border-default)" }}
		>
			<div
				className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[var(--bg-hover)]"
				style={{ backgroundColor: "var(--bg-secondary)" }}
				onClick={() => setExpanded(!expanded)}
			>
				<div className="flex items-center gap-2 flex-1 min-w-0">
					{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
					{isTranslating ? (
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
								<AlertTriangle
									size={14}
									className="shrink-0"
									style={{ color: "var(--accent-warning)" }}
								/>
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
					)}
				</div>
				{!isTranslating && (
					<button
						onClick={(e) => {
							e.stopPropagation();
							onDelete();
						}}
						className="p-1 rounded hover:bg-[var(--bg-hover)]"
					>
						<Trash2 size={14} style={{ color: "var(--accent-danger)" }} />
					</button>
				)}
			</div>

			{expanded && (
				<div className="p-4 space-y-2">
					{(options ?? []).map((opt) => {
						if (isTranslating) {
							const translated = opt.translations?.[selectedLang]?.name ?? "";
							return (
								<div
									key={opt._id}
									className="flex items-center gap-3 px-3 py-2 rounded"
									style={{
										backgroundColor: "var(--bg-primary)",
										border: !translated
											? "1px solid var(--accent-warning)"
											: "1px solid transparent",
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
						<form onSubmit={handleAddOption} className="flex gap-2 pt-2">
							<input
								type="text"
								value={optName}
								onChange={(e) => setOptName(e.target.value)}
								placeholder="Option name"
								required
								className="flex-1 px-2 py-1.5 rounded text-sm"
								style={{
									backgroundColor: "var(--bg-secondary)",
									border: "1px solid var(--border-default)",
									color: "var(--text-primary)",
								}}
							/>
							<input
								type="number"
								value={optPrice}
								onChange={(e) => setOptPrice(e.target.value)}
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
							<button
								type="submit"
								className="px-3 py-1.5 rounded text-sm font-medium hover-btn-primary"
							>
								<Plus size={14} />
							</button>
						</form>
					)}
				</div>
			)}
		</div>
	);
}

function InlineEditInput({
	value,
	placeholder,
	onSave,
	className,
	inputMode,
	prefix,
}: Readonly<{
	value: string;
	placeholder: string;
	onSave: (value: string) => Promise<unknown>;
	className?: string;
	inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
	prefix?: string;
}>) {
	const [draft, setDraft] = useState(value);
	const [dirty, setDirty] = useState(false);

	const save = async () => {
		if (draft !== value) {
			await onSave(draft);
			setDirty(false);
		}
	};

	const input = (
		<input
			type="text"
			inputMode={inputMode}
			value={dirty ? draft : value}
			onChange={(e) => {
				setDraft(e.target.value);
				setDirty(true);
			}}
			onBlur={save}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					(e.target as HTMLInputElement).blur();
				}
			}}
			onClick={(e) => e.stopPropagation()}
			placeholder={placeholder}
			className={`flex-1 min-w-0 px-2 py-1 rounded ${className ?? "text-sm"}`}
			style={{
				backgroundColor: "var(--bg-primary)",
				border: "1px solid var(--border-default)",
				color: "var(--text-primary)",
			}}
		/>
	);

	if (prefix) {
		return (
			<div className={`flex items-center gap-1 ${className ?? ""}`}>
				<span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>
					{prefix}
				</span>
				{input}
			</div>
		);
	}

	return input;
}
