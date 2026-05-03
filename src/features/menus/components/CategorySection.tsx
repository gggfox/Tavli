import { CollapsibleCard, InlineEditInput } from "@/global/components";
import { MenusKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
}

export function CategorySection({
	category,
	restaurantId,
	onDeleteCategory,
	selectedLang,
}: Readonly<CategorySectionProps>) {
	const { t } = useTranslation();
	const isTranslating = !!selectedLang;
	const [expanded, setExpanded] = useState(true);
	const {
		items,
		createItem,
		updateItem,
		removeItem,
		toggleAvailability: toggleAvail,
		bulkRemoveItems,
		bulkSetAvailability,
		generateUploadUrl,
	} = useMenuItems(category._id, restaurantId);

	const setCategoryTranslation = useMutation({
		mutationFn: useConvexMutation(api.menus.setCategoryTranslation),
	});
	const setItemTranslation = useMutation({
		mutationFn: useConvexMutation(api.menuItems.setTranslation),
	});

	const [showAddForm, setShowAddForm] = useState(false);
	const [selectedIds, setSelectedIds] = useState(() => new Set<Id<"menuItems">>());
	const selectAllRef = useRef<HTMLInputElement>(null);

	const rowItems = items as MenuItemRowDoc[];
	const sorted = [...rowItems].sort((a, b) => a.displayOrder - b.displayOrder);
	const allSelected = sorted.length > 0 && sorted.every((item) => selectedIds.has(item._id));

	const itemIdsFingerprint = useMemo(
		() =>
			[...(items as MenuItemRowDoc[])]
				.map((i) => i._id)
				.sort()
				.join(","),
		[items]
	);

	useEffect(() => {
		const valid = new Set(rowItems.map((i) => i._id));
		setSelectedIds((prev) => {
			let changed = false;
			const next = new Set<Id<"menuItems">>();
			for (const id of prev) {
				if (valid.has(id)) next.add(id);
				else changed = true;
			}
			return changed ? next : prev;
		});
	}, [itemIdsFingerprint]);

	useEffect(() => {
		const el = selectAllRef.current;
		if (!el) return;
		el.indeterminate = selectedIds.size > 0 && !allSelected;
	}, [selectedIds, allSelected]);

	const handleToggleSelectAll = () => {
		if (allSelected) setSelectedIds(new Set());
		else setSelectedIds(new Set(sorted.map((i) => i._id)));
	};

	const handleBulkHide = async () => {
		const itemIds = [...selectedIds];
		if (itemIds.length === 0) return;
		unwrapResult(
			await bulkSetAvailability({
				restaurantId,
				itemIds,
				isAvailable: false,
			})
		);
		setSelectedIds(new Set());
	};

	const handleBulkShow = async () => {
		const itemIds = [...selectedIds];
		if (itemIds.length === 0) return;
		unwrapResult(
			await bulkSetAvailability({
				restaurantId,
				itemIds,
				isAvailable: true,
			})
		);
		setSelectedIds(new Set());
	};

	const handleBulkDelete = async () => {
		const itemIds = [...selectedIds];
		if (itemIds.length === 0) return;
		unwrapResult(await bulkRemoveItems({ restaurantId, itemIds }));
		setSelectedIds(new Set());
	};

	const headerContent = isTranslating ? (
		<div className="flex items-center gap-2 flex-1 min-w-0">
			<span className="text-sm shrink-0 text-faint-foreground" >
				{category.name} &rarr;
			</span>
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
				<AlertTriangle size={14} className="text-warning"  />
			)}
		</div>
	) : (
		<>
			<span className="text-sm font-medium text-foreground" >
				{category.name}
			</span>
			<span className="text-xs text-faint-foreground" >
				{t(MenusKeys.CATEGORY_ITEMS_COUNT, { count: sorted.length })}
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
							onDeleteCategory();
						}}
						className="p-1 rounded hover:bg-(--bg-hover) text-destructive"
						title={t(MenusKeys.CATEGORY_DELETE_TITLE)}
					>
						<Trash2 size={14}  />
					</button>
				) : undefined
			}
		>
			<div className="space-y-3">
				{!isTranslating && sorted.length > 0 ? (
					<div className="flex flex-wrap items-center gap-2 px-1 pb-1 border-b border-border">
						<label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
							<input
								ref={selectAllRef}
								type="checkbox"
								checked={allSelected}
								onChange={handleToggleSelectAll}
								className="h-4 w-4 rounded border-border accent-[var(--btn-primary-bg)]"
							/>
							{allSelected
								? t(MenusKeys.CATEGORY_DESELECT_ALL)
								: t(MenusKeys.CATEGORY_SELECT_ALL)}
						</label>
						{selectedIds.size > 0 ? (
							<>
								<button
									type="button"
									onClick={() => void handleBulkHide()}
									className="px-2 py-1 rounded-md text-xs font-medium border border-border hover:bg-hover"
								>
									{t(MenusKeys.CATEGORY_BULK_HIDE)}
								</button>
								<button
									type="button"
									onClick={() => void handleBulkShow()}
									className="px-2 py-1 rounded-md text-xs font-medium border border-border hover:bg-hover"
								>
									{t(MenusKeys.CATEGORY_BULK_SHOW)}
								</button>
								<button
									type="button"
									onClick={() => void handleBulkDelete()}
									className="px-2 py-1 rounded-md text-xs font-medium text-destructive border border-border hover:bg-hover"
								>
									{t(MenusKeys.CATEGORY_BULK_DELETE)}
								</button>
							</>
						) : null}
					</div>
				) : null}
				{sorted.map((item) =>
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
									setSelectedIds((prev) => {
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
