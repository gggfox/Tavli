import { useConvexMutate } from "@/global/hooks";
import { MenusKeys, OptionsKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Check, Plus, Settings2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OptionGroupManagerModal } from "../OptionGroupManagerModal";

type SelectionType = "single" | "multi";

/**
 * The item's option groups as toggle chips. Controlled: toggling only changes
 * the editor's draft, and the links are written with the rest of the item on
 * Guardar. A group created here is added to the draft the same way.
 */
export function ItemOptionGroupChips({
	restaurantId,
	value,
	onChange,
}: Readonly<{
	restaurantId: Id<"restaurants">;
	value: readonly Id<"optionGroups">[];
	onChange: (ids: Id<"optionGroups">[]) => void;
}>) {
	const { t } = useTranslation();
	const groupsQuery = useQuery(
		convexQuery(api.optionGroups.getGroupsByRestaurant, { restaurantId })
	);
	const createGroup = useConvexMutate(api.optionGroups.createGroup);
	const [creating, setCreating] = useState(false);
	const [managerOpen, setManagerOpen] = useState(false);
	const [name, setName] = useState("");
	const [selectionType, setSelectionType] = useState<SelectionType>("single");
	const [isRequired, setIsRequired] = useState(false);

	const groups = [...(groupsQuery.data ?? [])].sort((a, b) => a.displayOrder - b.displayOrder);
	const selected = new Set(value);

	const toggle = (id: Id<"optionGroups">) =>
		onChange(selected.has(id) ? value.filter((g) => g !== id) : [...value, id]);

	const submitNewGroup = async () => {
		if (!name.trim()) return;
		const groupId = unwrapResult<Id<"optionGroups">>(
			await createGroup.mutateAsync({
				restaurantId,
				name: name.trim(),
				selectionType,
				isRequired,
				minSelections: isRequired ? 1 : 0,
				maxSelections: selectionType === "single" ? 1 : 10,
			})
		);
		onChange([...value, groupId]);
		setName("");
		setIsRequired(false);
		setCreating(false);
	};

	return (
		<section className="space-y-2">
			<span className="block text-xs font-medium text-muted-foreground">
				{t(MenusKeys.ITEM_EDITOR_OPTIONS)}
			</span>
			{groupsQuery.isPending ? (
				<p className="text-xs text-muted-foreground">{t(MenusKeys.PICKER_LOADING)}</p>
			) : groupsQuery.isError ? (
				<p className="text-xs text-destructive">{t(MenusKeys.PICKER_ERROR)}</p>
			) : (
				<div className="flex flex-wrap gap-1.5">
					{groups.map((group) => {
						const on = selected.has(group._id);
						return (
							<button
								key={group._id}
								type="button"
								aria-pressed={on}
								onClick={() => toggle(group._id)}
								className={`flex h-9 items-center gap-1.5 rounded-full px-3 text-xs ring-1 transition-colors md:h-7 ${
									on
										? "bg-primary/15 text-foreground ring-primary/55"
										: "text-muted-foreground ring-border hover:text-foreground"
								}`}
							>
								{on ? (
									<Check size={12} className="text-primary" aria-hidden />
								) : (
									<Plus size={12} aria-hidden />
								)}
								{group.name}
								<span className="text-faint-foreground">
									·{" "}
									{group.selectionType === "single"
										? t(MenusKeys.PICKER_GROUP_SINGLE)
										: t(MenusKeys.PICKER_GROUP_MULTI)}
								</span>
							</button>
						);
					})}
					{creating ? null : (
						<button
							type="button"
							onClick={() => setCreating(true)}
							className="flex h-9 items-center gap-1 rounded-full px-2 text-xs text-primary hover:underline md:h-7"
						>
							<Plus size={12} aria-hidden /> {t(MenusKeys.ITEM_EDITOR_NEW_GROUP)}
						</button>
					)}
					<button
						type="button"
						onClick={() => setManagerOpen(true)}
						className="flex h-9 items-center gap-1 rounded-full px-2 text-xs text-primary hover:underline md:h-7"
					>
						<Settings2 size={12} aria-hidden /> {t(MenusKeys.PICKER_MANAGE_GROUPS)}
					</button>
				</div>
			)}

			{creating ? (
				// Not a <form>: the editor around it may already be one.
				<div className="space-y-2 rounded-lg border border-border bg-background p-2.5">
					<input
						value={name}
						onChange={(e) => setName(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								void submitNewGroup();
							}
						}}
						placeholder={t(OptionsKeys.GROUP_NAME_PLACEHOLDER)}
						aria-label={t(OptionsKeys.GROUP_NAME_PLACEHOLDER)}
						className="w-full rounded-md border border-input-border bg-input px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-input-border-focus"
					/>
					<div className="flex flex-wrap items-center gap-3">
						<select
							value={selectionType}
							onChange={(e) => setSelectionType(e.target.value as SelectionType)}
							aria-label={t(MenusKeys.PICKER_SELECTION_TYPE_LABEL)}
							className="rounded-md border border-input-border bg-input px-2 py-1 text-xs text-foreground"
						>
							<option value="single">{t(OptionsKeys.SELECTION_SINGLE)}</option>
							<option value="multi">{t(OptionsKeys.SELECTION_MULTI)}</option>
						</select>
						<label className="flex items-center gap-2 text-xs text-muted-foreground">
							<input
								type="checkbox"
								checked={isRequired}
								onChange={(e) => setIsRequired(e.target.checked)}
							/>
							{t(OptionsKeys.REQUIRED_LABEL)}
						</label>
						<div className="ml-auto flex gap-1.5">
							<button
								type="button"
								onClick={() => setCreating(false)}
								className="rounded-md px-2.5 py-1 text-xs hover-btn-secondary"
							>
								{t(OptionsKeys.CANCEL_BUTTON)}
							</button>
							<button
								type="button"
								onClick={() => void submitNewGroup()}
								disabled={!name.trim() || createGroup.isPending}
								className="rounded-md px-2.5 py-1 text-xs font-medium hover-btn-primary disabled:opacity-50"
							>
								{t(OptionsKeys.CREATE_BUTTON)}
							</button>
						</div>
					</div>
				</div>
			) : null}

			<OptionGroupManagerModal
				restaurantId={restaurantId}
				isOpen={managerOpen}
				onClose={() => setManagerOpen(false)}
			/>
		</section>
	);
}
