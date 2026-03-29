import { CollapsibleCard, InlineEditInput } from "@/global/components";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useMenuItems } from "../hooks/useMenus";
import { AddItemForm } from "./AddItemForm";
import { MenuItemRow } from "./MenuItemRow";
import { MenuItemTranslationRow } from "./MenuItemTranslationRow";

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
	const isTranslating = !!selectedLang;
	const [expanded, setExpanded] = useState(true);
	const {
		items,
		createItem,
		updateItem,
		removeItem,
		toggleAvailability: toggleAvail,
		generateUploadUrl,
	} = useMenuItems(category._id);

	const setCategoryTranslation = useMutation({
		mutationFn: useConvexMutation(api.menus.setCategoryTranslation),
	});
	const setItemTranslation = useMutation({
		mutationFn: useConvexMutation(api.menuItems.setTranslation),
	});

	const [showAddForm, setShowAddForm] = useState(false);
	const sorted = [...items].sort((a, b) => a.displayOrder - b.displayOrder);

	const headerContent = isTranslating ? (
		<div className="flex items-center gap-2 flex-1 min-w-0">
			<span className="text-sm shrink-0" style={{ color: "var(--text-muted)" }}>
				{category.name} &rarr;
			</span>
			<InlineEditInput
				value={category.translations?.[selectedLang]?.name ?? ""}
				placeholder={`${category.name} translation...`}
				onSave={(val) =>
					setCategoryTranslation.mutateAsync({
						categoryId: category._id,
						lang: selectedLang,
						name: val,
					})
				}
			/>
			{!category.translations?.[selectedLang]?.name && (
				<AlertTriangle size={14} style={{ color: "var(--accent-warning)" }} />
			)}
		</div>
	) : (
		<>
			<span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
				{category.name}
			</span>
			<span className="text-xs" style={{ color: "var(--text-muted)" }}>
				({sorted.length} items)
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
						className="p-1 rounded hover:bg-(--bg-hover)"
						title="Delete category"
					>
						<Trash2 size={14} style={{ color: "var(--accent-danger)" }} />
					</button>
				) : undefined
			}
		>
			<div className="space-y-3">
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
							restaurantId={restaurantId}
							onUpdate={updateItem}
							onRemove={removeItem}
							onToggleAvailability={toggleAvail}
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
						className="flex items-center gap-1 text-sm py-2 hover:underline"
						style={{ color: "var(--btn-primary-bg)" }}
					>
						<Plus size={14} /> Add item
					</button>
				)}
			</div>
		</CollapsibleCard>
	);
}
