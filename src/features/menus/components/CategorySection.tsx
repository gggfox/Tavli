import { InlineEditInput } from "@/global/components";
import { useFuzzyMatch } from "@/global/hooks/useFuzzyMatch";
import { MenusKeys } from "@/global/i18n";
import { getTranslatedField } from "@/global/utils/translations";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { AlertTriangle, Check, ChevronDown, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMenuItems } from "../hooks/useMenus";
import { sectionSelectionState } from "../utils/selection";
import { AddItemForm } from "./AddItemForm";
import { categoryAnchorId } from "./CategoryIndex";
import { MenuItemRow } from "./MenuItemRow";
import { MenuItemTranslationRow } from "./MenuItemTranslationRow";

/** Row shape from `listByCategoryForStaff` (image URLs resolved); matches `MenuItemRow`. */
type MenuItemRowDoc = Doc<"menuItems"> & { imageUrl?: string | null };

interface CategorySectionProps {
	category: Doc<"menuCategories">;
	restaurantId: Id<"restaurants">;
	onDeleteCategory: () => void;
	selectedLang?: string;
	searchQuery?: string;
	filterLang?: string;
	onFilterVisibility?: (visible: boolean) => void;
	expanded: boolean;
	onExpandedChange: (expanded: boolean) => void;
	selectedIds: ReadonlySet<Id<"menuItems">>;
	onToggleSelect: (itemId: Id<"menuItems">, e: { shiftKey: boolean }) => void;
	/** Select every visible item of this section, or clear them when all are selected. */
	onToggleSection: (itemIds: Id<"menuItems">[]) => void;
	editingItemId: Id<"menuItems"> | null;
	onEditItem: (itemId: Id<"menuItems">) => void;
	onVisibleItemIdsChange?: (itemIds: Id<"menuItems">[]) => void;
}

export function CategorySection({
	category,
	restaurantId,
	onDeleteCategory,
	selectedLang,
	searchQuery = "",
	filterLang,
	onFilterVisibility,
	expanded,
	onExpandedChange,
	selectedIds,
	onToggleSelect,
	onToggleSection,
	editingItemId,
	onEditItem,
	onVisibleItemIdsChange,
}: Readonly<CategorySectionProps>) {
	const { t } = useTranslation();
	const isTranslating = !!selectedLang;
	const { matches, isActive: isFilterActive } = useFuzzyMatch(searchQuery);
	const { items, createItem, removeItem, toggleAvailability, generateUploadUrl } = useMenuItems(
		category._id,
		restaurantId
	);

	const setCategoryTranslation = useMutation({
		mutationFn: useConvexMutation(api.menus.setCategoryTranslation),
	});
	const setItemTranslation = useMutation({
		mutationFn: useConvexMutation(api.menuItems.setTranslation),
	});

	const [showAddForm, setShowAddForm] = useState(false);

	const rowItems = items as MenuItemRowDoc[];
	const sorted = [...rowItems].sort((a, b) => a.displayOrder - b.displayOrder);

	const categoryNameForFilter = filterLang
		? getTranslatedField(category, filterLang)
		: category.name;
	const categoryNameMatches = matches(categoryNameForFilter);

	const visibleItems = useMemo(() => {
		if (!isFilterActive || categoryNameMatches) return sorted;
		return sorted.filter((item) =>
			matches(filterLang ? getTranslatedField(item, filterLang) : item.name)
		);
	}, [sorted, isFilterActive, categoryNameMatches, matches, filterLang]);

	const isVisible = !isFilterActive || categoryNameMatches || visibleItems.length > 0;

	const visibleItemIds = useMemo(() => visibleItems.map((item) => item._id), [visibleItems]);
	const visibleItemIdsFingerprint = visibleItemIds.join(",");

	useEffect(() => {
		onFilterVisibility?.(isVisible);
	}, [isVisible, onFilterVisibility]);

	useEffect(() => {
		if (!isVisible) {
			onVisibleItemIdsChange?.([]);
			return;
		}
		onVisibleItemIdsChange?.(visibleItemIds);
	}, [isVisible, visibleItemIdsFingerprint, onVisibleItemIdsChange, visibleItemIds]);

	if (!isVisible) return null;

	const selection = sectionSelectionState(selectedIds, visibleItemIds);
	const fullySelected = !isTranslating && selection.state === "all";

	return (
		<section
			id={categoryAnchorId(category._id)}
			data-category-anchor={category._id}
			aria-label={category.name}
			className={`group/category scroll-mt-[calc(var(--admin-chrome-height,7rem)+1rem)] rounded-xl border transition-colors ${
				fullySelected ? "border-primary/50 bg-primary/[0.06]" : "border-border bg-muted/40"
			}`}
		>
			<header className="flex items-center gap-2 py-2 pl-2 pr-2 md:pr-3">
				{isTranslating ? (
					<div className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-0.5 pr-2">
						<button
							type="button"
							onClick={() => onExpandedChange(!expanded)}
							aria-expanded={expanded}
							aria-label={category.name}
							className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-hover"
						>
							<ChevronDown
								size={16}
								aria-hidden
								className={`text-muted-foreground transition-transform ${expanded ? "" : "-rotate-90"}`}
							/>
						</button>
						<span className="shrink-0 text-sm text-faint-foreground">{category.name} &rarr;</span>
						<InlineEditInput
							value={category.translations?.[selectedLang]?.name ?? ""}
							placeholder={t(MenusKeys.CATEGORY_TRANSLATION_PLACEHOLDER, { name: category.name })}
							onSave={(val) =>
								setCategoryTranslation.mutateAsync({
									categoryId: category._id,
									lang: selectedLang,
									name: val,
								})
							}
						/>
						{category.translations?.[selectedLang]?.name ? null : (
							<AlertTriangle size={14} className="text-warning" />
						)}
					</div>
				) : (
					<button
						type="button"
						onClick={() => onExpandedChange(!expanded)}
						aria-expanded={expanded}
						className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-hover"
					>
						<ChevronDown
							size={16}
							aria-hidden
							className={`shrink-0 text-muted-foreground transition-transform ${expanded ? "" : "-rotate-90"}`}
						/>
						<span className="truncate text-[15px] font-semibold text-foreground">
							{category.name}
						</span>
						<span className="text-xs tabular-nums text-faint-foreground">
							{visibleItems.length}
						</span>
					</button>
				)}
				{!isTranslating && visibleItemIds.length > 0 ? (
					<button
						type="button"
						onClick={() => onToggleSection(visibleItemIds)}
						aria-pressed={selection.state === "all"}
						className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition ${
							selection.state === "all"
								? "bg-primary text-primary-foreground"
								: selection.state === "some"
									? "bg-primary/15 text-primary ring-1 ring-primary/50"
									: "text-muted-foreground ring-1 ring-border hover:text-foreground focus-visible:opacity-100 md:opacity-0 md:group-hover/category:opacity-100"
						}`}
					>
						{selection.state === "all" ? <Check size={13} aria-hidden /> : null}
						{selection.state === "all"
							? t(MenusKeys.EDITOR_SECTION_SELECTED)
							: selection.state === "some"
								? t(MenusKeys.EDITOR_SECTION_PARTIAL, {
										count: selection.count,
										total: visibleItemIds.length,
									})
								: t(MenusKeys.EDITOR_SELECT_SECTION)}
					</button>
				) : null}
				{isTranslating ? null : (
					<button
						type="button"
						onClick={onDeleteCategory}
						aria-label={t(MenusKeys.CATEGORY_DELETE_TITLE)}
						title={t(MenusKeys.CATEGORY_DELETE_TITLE)}
						className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-faint-foreground hover:bg-hover hover:text-destructive md:h-8 md:w-8"
					>
						<Trash2 size={15} />
					</button>
				)}
			</header>

			{expanded ? (
				<div className="space-y-1.5 px-2 pb-2">
					{visibleItems.map((item) =>
						isTranslating ? (
							<MenuItemTranslationRow
								key={item._id}
								item={item}
								selectedLang={selectedLang}
								onSaveTranslation={(args) => setItemTranslation.mutateAsync(args)}
							/>
						) : (
							<MenuItemRow
								key={item._id}
								item={item}
								isSelected={selectedIds.has(item._id)}
								isEditing={editingItemId === item._id}
								onToggleSelect={(e) => onToggleSelect(item._id, e)}
								onEdit={() => onEditItem(item._id)}
								onToggleAvailability={toggleAvailability}
								onRemove={removeItem}
							/>
						)
					)}

					{isTranslating ? null : showAddForm ? (
						<AddItemForm
							categoryId={category._id}
							restaurantId={restaurantId}
							generateUploadUrl={generateUploadUrl}
							onCreateItem={createItem}
							onCancel={() => setShowAddForm(false)}
						/>
					) : (
						<button
							type="button"
							onClick={() => setShowAddForm(true)}
							className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-primary hover:bg-hover"
						>
							<Plus size={15} aria-hidden /> {t(MenusKeys.CATEGORY_ADD_ITEM)}
						</button>
					)}
				</div>
			) : null}
		</section>
	);
}
