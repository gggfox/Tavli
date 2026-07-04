import { CollapsibleCard, InlineEditInput } from "@/global/components";
import { useFuzzyMatch } from "@/global/hooks/useFuzzyMatch";
import { MenusKeys } from "@/global/i18n";
import { getTranslatedField } from "@/global/utils/translations";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMenuItems } from "../hooks/useMenus";
import { AddItemForm } from "./AddItemForm";
import { MenuItemRow } from "./MenuItemRow";
import { MenuItemTranslationRow } from "./MenuItemTranslationRow";

/** Row shape from `getByCategory` (image URLs resolved); matches `MenuItemRow`. */
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
	onSelectedIdsChange: (updater: (prev: Set<Id<"menuItems">>) => Set<Id<"menuItems">>) => void;
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
	onSelectedIdsChange,
	onVisibleItemIdsChange,
}: Readonly<CategorySectionProps>) {
	const { t } = useTranslation();
	const isTranslating = !!selectedLang;
	const { matches, isActive: isFilterActive } = useFuzzyMatch(searchQuery);
	const {
		items,
		createItem,
		updateItem,
		removeItem,
		toggleAvailability: toggleAvail,
		generateUploadUrl,
	} = useMenuItems(category._id, restaurantId);

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

	const headerContent = isTranslating ? (
		<div className="flex items-center gap-2 flex-1 min-w-0">
			<span className="text-sm shrink-0 text-faint-foreground">{category.name} &rarr;</span>
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
			{!category.translations?.[selectedLang]?.name && (
				<AlertTriangle size={14} className="text-warning" />
			)}
		</div>
	) : (
		<>
			<span className="text-sm font-medium text-foreground">{category.name}</span>
			<span className="text-xs text-faint-foreground">
				{t(MenusKeys.CATEGORY_ITEMS_COUNT, { count: visibleItems.length })}
			</span>
		</>
	);

	if (!isVisible) return null;

	return (
		<CollapsibleCard
			expanded={expanded}
			onToggle={() => onExpandedChange(!expanded)}
			headerContent={headerContent}
			headerActions={
				!isTranslating ? (
					<button
						onClick={(e) => {
							e.stopPropagation();
							onDeleteCategory();
						}}
						className="p-1 rounded hover:bg-(--bg-hover) text-destructive"
						title={t(MenusKeys.CATEGORY_DELETE_TITLE)}
					>
						<Trash2 size={14} />
					</button>
				) : undefined
			}
		>
			<div className="space-y-3">
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
							onUpdate={updateItem}
							onRemove={removeItem}
							onToggleAvailability={toggleAvail}
							bulkSelect={{
								isSelected: selectedIds.has(item._id),
								onToggle: () =>
									onSelectedIdsChange((prev) => {
										const next = new Set(prev);
										if (next.has(item._id)) next.delete(item._id);
										else next.add(item._id);
										return next;
									}),
							}}
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
						onClick={() => setShowAddForm(true)}
						className="flex items-center gap-1 text-sm py-2 hover:underline text-primary"
					>
						<Plus size={14} /> {t(MenusKeys.CATEGORY_ADD_ITEM)}
					</button>
				)}
			</div>
		</CollapsibleCard>
	);
}
