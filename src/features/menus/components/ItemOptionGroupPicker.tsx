import { useConvexMutate } from "@/global/hooks";
import { MenusKeys, OptionsKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { convexQuery } from "@convex-dev/react-query";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Plus, Settings2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OptionGroupManagerModal } from "./OptionGroupManagerModal";

interface ItemOptionGroupPickerProps {
	itemId: Id<"menuItems">;
	/** Must match the owning menu item's `restaurantId` (not necessarily the navbar selection). */
	restaurantId: Id<"restaurants">;
}

/**
 * Option groups for one menu item, rendered inside the item edit panel.
 *
 * Three things live here so the manager never has to leave the item to answer
 * "what specifications does this item offer?":
 *   - toggle any of the restaurant's groups on or off for this item,
 *   - create a brand new group and have it linked to this item straight away,
 *   - open the full `OptionGroupManager` to author the choices inside a group.
 *
 * Unlike the surrounding edit form, the toggles here write immediately -- they
 * are junction rows, not fields of the item.
 */
export function ItemOptionGroupPicker({
	itemId,
	restaurantId,
}: Readonly<ItemOptionGroupPickerProps>) {
	const { t } = useTranslation();
	const [showCreateForm, setShowCreateForm] = useState(false);
	const [managerOpen, setManagerOpen] = useState(false);

	const allGroupsQuery = useQuery(
		convexQuery(api.optionGroups.getGroupsByRestaurant, { restaurantId })
	);
	const linkedGroupsQuery = useQuery(
		convexQuery(api.optionGroups.getGroupsForMenuItem, { menuItemId: itemId })
	);

	const linkMutation = useConvexMutate(api.optionGroups.linkToMenuItem);
	const unlinkMutation = useConvexMutate(api.optionGroups.unlinkFromMenuItem);
	const createGroupMutation = useConvexMutate(api.optionGroups.createGroup);

	const loading = allGroupsQuery.isPending || linkedGroupsQuery.isPending;
	const loadError = allGroupsQuery.isError || linkedGroupsQuery.isError;

	const allGroups = allGroupsQuery.data;
	const linkedGroups = linkedGroupsQuery.data;

	const linkedIds = new Set(
		(linkedGroups ?? []).filter((g): g is NonNullable<typeof g> => g != null).map((g) => g._id)
	);
	const sorted = [...(allGroups ?? [])].sort((a, b) => a.displayOrder - b.displayOrder);

	const handleToggle = async (groupId: Id<"optionGroups">) => {
		if (linkedIds.has(groupId)) {
			unwrapResult(
				await unlinkMutation.mutateAsync({ menuItemId: itemId, optionGroupId: groupId })
			);
		} else {
			unwrapResult(
				await linkMutation.mutateAsync({
					menuItemId: itemId,
					optionGroupId: groupId,
					restaurantId,
				})
			);
		}
	};

	const createGroupForm = useForm({
		defaultValues: {
			name: "",
			selType: "single" as "single" | "multi",
			isRequired: false,
		},
		onSubmit: async ({ value }) => {
			if (!value.name.trim()) return;
			// A group the manager created from inside an item is meant for that
			// item, so link it here instead of making them hunt for it in the
			// chip list afterwards.
			const groupId = unwrapResult<Id<"optionGroups">>(
				await createGroupMutation.mutateAsync({
					restaurantId,
					name: value.name.trim(),
					selectionType: value.selType,
					isRequired: value.isRequired,
					minSelections: value.isRequired ? 1 : 0,
					maxSelections: value.selType === "single" ? 1 : 10,
				})
			);
			unwrapResult(
				await linkMutation.mutateAsync({
					menuItemId: itemId,
					optionGroupId: groupId,
					restaurantId,
				})
			);
			createGroupForm.reset();
			setShowCreateForm(false);
		},
	});

	return (
		<section className="space-y-2">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="text-xs font-medium text-faint-foreground">
					{t(MenusKeys.ITEM_OPTIONS_TITLE)}
				</span>
				<button
					type="button"
					onClick={() => setManagerOpen(true)}
					className="flex items-center gap-1 text-xs text-primary hover:underline"
				>
					<Settings2 size={12} /> {t(MenusKeys.PICKER_MANAGE_GROUPS)}
				</button>
			</div>
			<p className="text-xs text-muted-foreground">{t(MenusKeys.PICKER_HINT)}</p>

			{loading && <p className="text-xs text-muted-foreground">{t(MenusKeys.PICKER_LOADING)}</p>}
			{!loading && loadError && (
				<p className="text-xs text-destructive">{t(MenusKeys.PICKER_ERROR)}</p>
			)}

			{!loading && !loadError && (
				<>
					{sorted.length === 0 ? (
						<p className="text-xs text-faint-foreground">{t(MenusKeys.PICKER_NO_GROUPS)}</p>
					) : (
						<div className="flex flex-wrap gap-2">
							{sorted.map((group) => {
								const isLinked = linkedIds.has(group._id);
								return (
									<button
										key={group._id}
										type="button"
										aria-pressed={isLinked}
										onClick={() => handleToggle(group._id)}
										disabled={linkMutation.isPending || unlinkMutation.isPending}
										className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors disabled:opacity-50"
										style={{
											backgroundColor: isLinked ? "var(--btn-primary-bg)" : "var(--bg-primary)",
											color: isLinked ? "var(--btn-primary-text)" : "var(--text-secondary)",
											border: isLinked
												? "1px solid transparent"
												: "1px solid var(--border-default)",
										}}
									>
										{group.name}
										<span className="ml-1 opacity-70">
											{group.selectionType === "single"
												? t(MenusKeys.PICKER_GROUP_SINGLE)
												: t(MenusKeys.PICKER_GROUP_MULTI)}
										</span>
									</button>
								);
							})}
						</div>
					)}

					{showCreateForm ? (
						<form
							onSubmit={(e) => {
								e.preventDefault();
								e.stopPropagation();
								createGroupForm.handleSubmit();
							}}
							className="space-y-2 p-2 rounded-lg bg-background border border-border"
						>
							<createGroupForm.Field
								name="name"
								children={(field) => (
									<input
										type="text"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(OptionsKeys.GROUP_NAME_PLACEHOLDER)}
										required
										className="w-full px-2 py-1.5 rounded text-sm bg-muted border border-border text-foreground"
									/>
								)}
							/>
							<div className="flex flex-wrap items-center gap-3">
								<createGroupForm.Field
									name="selType"
									children={(field) => (
										<select
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value as "single" | "multi")}
											aria-label={t(MenusKeys.PICKER_SELECTION_TYPE_LABEL)}
											className="px-2 py-1 rounded text-xs bg-muted border border-border text-foreground"
										>
											<option value="single">{t(OptionsKeys.SELECTION_SINGLE)}</option>
											<option value="multi">{t(OptionsKeys.SELECTION_MULTI)}</option>
										</select>
									)}
								/>
								<label className="flex items-center gap-2 text-xs text-muted-foreground">
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
									{t(OptionsKeys.REQUIRED_LABEL)}
								</label>
							</div>
							<div className="flex gap-2">
								<createGroupForm.Subscribe
									selector={(state) => state.isSubmitting}
									children={(isSubmitting) => (
										<button
											type="submit"
											disabled={isSubmitting}
											className="px-3 py-1.5 rounded text-xs font-medium hover-btn-primary disabled:opacity-50"
										>
											{t(OptionsKeys.CREATE_BUTTON)}
										</button>
									)}
								/>
								<button
									type="button"
									onClick={() => setShowCreateForm(false)}
									className="px-3 py-1.5 rounded text-xs hover-btn-secondary"
								>
									{t(OptionsKeys.CANCEL_BUTTON)}
								</button>
							</div>
						</form>
					) : (
						<button
							type="button"
							onClick={() => setShowCreateForm(true)}
							className="flex items-center gap-1 text-xs text-primary hover:underline"
						>
							<Plus size={12} /> {t(OptionsKeys.NEW_GROUP_BUTTON)}
						</button>
					)}
				</>
			)}

			<OptionGroupManagerModal
				restaurantId={restaurantId}
				isOpen={managerOpen}
				onClose={() => setManagerOpen(false)}
			/>
		</section>
	);
}
