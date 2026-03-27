import { unwrapResult } from "@/global/utils/unwrapResult";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { ChevronDown, ChevronRight, Eye, EyeOff, ListChecks, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

interface MenuEditorProps {
	menuId: Id<"menus">;
	restaurantId: Id<"restaurants">;
}

export function MenuEditor({ menuId, restaurantId }: Readonly<MenuEditorProps>) {
	const { data: categories } = useQuery(convexQuery(api.menus.getCategoriesByMenu, { menuId }));
	const createCategory = useMutation({ mutationFn: useConvexMutation(api.menus.createCategory) });
	const deleteCategory = useMutation({ mutationFn: useConvexMutation(api.menus.deleteCategory) });

	const [newCatName, setNewCatName] = useState("");

	const sorted = [...(categories ?? [])].sort((a, b) => a.displayOrder - b.displayOrder);

	const handleAddCategory = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!newCatName.trim()) return;
		await createCategory.mutateAsync({ menuId, restaurantId, name: newCatName.trim() });
		setNewCatName("");
	};

	return (
		<div className="space-y-6">
			<form onSubmit={handleAddCategory} className="flex gap-3">
				<input
					type="text"
					value={newCatName}
					onChange={(e) => setNewCatName(e.target.value)}
					placeholder="New category (e.g. Appetizers)"
					className="flex-1 px-3 py-2 rounded-lg text-sm"
					style={{
						backgroundColor: "var(--bg-secondary)",
						border: "1px solid var(--border-default)",
						color: "var(--text-primary)",
					}}
				/>
				<button
					type="submit"
					className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
				>
					<Plus size={16} /> Add Category
				</button>
			</form>

			{sorted.map((cat) => (
				<CategorySection
					key={cat._id}
					category={cat}
					restaurantId={restaurantId}
					onDeleteCategory={() => deleteCategory.mutateAsync({ categoryId: cat._id })}
				/>
			))}
			{sorted.length === 0 && (
				<p className="text-sm py-8 text-center" style={{ color: "var(--text-muted)" }}>
					No categories yet. Add your first category above.
				</p>
			)}
		</div>
	);
}

function CategorySection({
	category,
	restaurantId,
	onDeleteCategory,
}: Readonly<{
	category: Doc<"menuCategories">;
	restaurantId: Id<"restaurants">;
	onDeleteCategory: () => void;
}>) {
	const [expanded, setExpanded] = useState(true);
	const { data: items } = useQuery(
		convexQuery(api.menuItems.getByCategory, { categoryId: category._id })
	);
	const createItem = useMutation({ mutationFn: useConvexMutation(api.menuItems.create) });
	const removeItem = useMutation({ mutationFn: useConvexMutation(api.menuItems.remove) });
	const toggleAvail = useMutation({
		mutationFn: useConvexMutation(api.menuItems.toggleAvailability),
	});

	const [showAddForm, setShowAddForm] = useState(false);
	const [itemName, setItemName] = useState("");
	const [itemPrice, setItemPrice] = useState("");
	const [itemDesc, setItemDesc] = useState("");
	const [optionsExpandedFor, setOptionsExpandedFor] = useState<Id<"menuItems"> | null>(null);

	const sorted = [...(items ?? [])].sort((a, b) => a.displayOrder - b.displayOrder);

	const handleAddItem = async (e: React.FormEvent) => {
		e.preventDefault();
		const price = Math.round(Number.parseFloat(itemPrice) * 100);
		if (Number.isNaN(price) || !itemName.trim()) return;
		await createItem.mutateAsync({
			categoryId: category._id,
			restaurantId,
			name: itemName.trim(),
			description: itemDesc || undefined,
			basePrice: price,
		});
		setItemName("");
		setItemPrice("");
		setItemDesc("");
		setShowAddForm(false);
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
				<div className="flex items-center gap-2">
					{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
					<span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
						{category.name}
					</span>
					<span className="text-xs" style={{ color: "var(--text-muted)" }}>
						({sorted.length} items)
					</span>
				</div>
				<button
					onClick={(e) => {
						e.stopPropagation();
						onDeleteCategory();
					}}
					className="p-1 rounded hover:bg-[var(--bg-hover)]"
					title="Delete category"
				>
					<Trash2 size={14} style={{ color: "var(--accent-danger)" }} />
				</button>
			</div>

			{expanded && (
				<div className="p-4 space-y-3">
					{sorted.map((item) => (
						<div key={item._id} className="space-y-0">
							<div
								className="flex items-center justify-between px-3 py-2 rounded-lg"
								style={{
									backgroundColor: "var(--bg-primary)",
									border: "1px solid var(--border-default)",
									borderBottomLeftRadius: optionsExpandedFor === item._id ? 0 : undefined,
									borderBottomRightRadius: optionsExpandedFor === item._id ? 0 : undefined,
								}}
							>
								<div>
									<span
										className="text-sm font-medium"
										style={{
											color: item.isAvailable ? "var(--text-primary)" : "var(--text-muted)",
										}}
									>
										{item.name}
									</span>
									{!item.isAvailable && item.unavailableReason && (
										<span className="text-xs ml-2" style={{ color: "var(--accent-warning)" }}>
											({item.unavailableReason})
										</span>
									)}
									<span className="text-sm ml-3" style={{ color: "var(--text-secondary)" }}>
										${(item.basePrice / 100).toFixed(2)}
									</span>
								</div>
								<div className="flex items-center gap-1">
									<button
										onClick={() =>
											setOptionsExpandedFor((prev) => (prev === item._id ? null : item._id))
										}
										className="p-1 rounded hover:bg-[var(--bg-hover)]"
										title="Link option groups"
									>
										<ItemOptionsIcon itemId={item._id} isActive={optionsExpandedFor === item._id} />
									</button>
									<button
										onClick={() => toggleAvail.mutateAsync({ itemId: item._id })}
										className="p-1 rounded hover:bg-[var(--bg-hover)]"
										title={item.isAvailable ? "Mark unavailable" : "Mark available"}
									>
										{item.isAvailable ? (
											<Eye size={16} style={{ color: "var(--accent-success)" }} />
										) : (
											<EyeOff size={16} style={{ color: "var(--text-muted)" }} />
										)}
									</button>
									<button
										onClick={() => removeItem.mutateAsync({ itemId: item._id })}
										className="p-1 rounded hover:bg-[var(--bg-hover)]"
										title="Remove item"
									>
										<Trash2 size={14} style={{ color: "var(--accent-danger)" }} />
									</button>
								</div>
							</div>
							{optionsExpandedFor === item._id && (
								<ItemOptionGroupPicker itemId={item._id} restaurantId={restaurantId} />
							)}
						</div>
					))}

					{showAddForm ? (
						<form onSubmit={handleAddItem} className="space-y-2 pt-2">
							<div className="flex gap-2">
								<input
									type="text"
									value={itemName}
									onChange={(e) => setItemName(e.target.value)}
									placeholder="Item name"
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
									value={itemPrice}
									onChange={(e) => setItemPrice(e.target.value)}
									placeholder="Price"
									required
									step="0.01"
									min="0"
									className="w-24 px-2 py-1.5 rounded text-sm"
									style={{
										backgroundColor: "var(--bg-secondary)",
										border: "1px solid var(--border-default)",
										color: "var(--text-primary)",
									}}
								/>
							</div>
							<input
								type="text"
								value={itemDesc}
								onChange={(e) => setItemDesc(e.target.value)}
								placeholder="Description (optional)"
								className="w-full px-2 py-1.5 rounded text-sm"
								style={{
									backgroundColor: "var(--bg-secondary)",
									border: "1px solid var(--border-default)",
									color: "var(--text-primary)",
								}}
							/>
							<div className="flex gap-2">
								<button
									type="submit"
									className="px-3 py-1.5 rounded text-sm font-medium hover-btn-primary"
								>
									Add
								</button>
								<button
									type="button"
									onClick={() => setShowAddForm(false)}
									className="px-3 py-1.5 rounded text-sm hover-btn-secondary"
								>
									Cancel
								</button>
							</div>
						</form>
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
			)}
		</div>
	);
}

function ItemOptionsIcon({
	itemId,
	isActive,
}: Readonly<{ itemId: Id<"menuItems">; isActive: boolean }>) {
	const { data: linkedGroups } = useQuery(
		convexQuery(api.optionGroups.getGroupsForMenuItem, { menuItemId: itemId })
	);
	const hasLinks = (linkedGroups ?? []).length > 0;

	return (
		<div className="relative">
			<ListChecks
				size={16}
				style={{ color: isActive ? "var(--btn-primary-bg)" : "var(--text-muted)" }}
			/>
			{hasLinks && (
				<div
					className="absolute -top-1 -right-1 w-2 h-2 rounded-full"
					style={{ backgroundColor: "var(--btn-primary-bg)" }}
				/>
			)}
		</div>
	);
}

function ItemOptionGroupPicker({
	itemId,
	restaurantId,
}: Readonly<{ itemId: Id<"menuItems">; restaurantId: Id<"restaurants"> }>) {
	const { data: allGroups } = useQuery(
		convexQuery(api.optionGroups.getGroupsByRestaurant, { restaurantId })
	);
	const { data: linkedGroups } = useQuery(
		convexQuery(api.optionGroups.getGroupsForMenuItem, { menuItemId: itemId })
	);

	const linkMutation = useMutation({
		mutationFn: useConvexMutation(api.optionGroups.linkToMenuItem),
	});
	const unlinkMutation = useMutation({
		mutationFn: useConvexMutation(api.optionGroups.unlinkFromMenuItem),
	});

	const linkedIds = new Set((linkedGroups ?? []).map((g: any) => g._id as string));
	const sorted = [...(allGroups ?? [])].sort((a, b) => a.displayOrder - b.displayOrder);

	const handleToggle = async (groupId: Id<"optionGroups">) => {
		if (linkedIds.has(groupId)) {
			unwrapResult(
				await unlinkMutation.mutateAsync({ menuItemId: itemId, optionGroupId: groupId })
			);
		} else {
			unwrapResult(
				await linkMutation.mutateAsync({ menuItemId: itemId, optionGroupId: groupId, restaurantId })
			);
		}
	};

	if (sorted.length === 0) {
		return (
			<div
				className="px-3 py-3 text-xs rounded-b-lg"
				style={{
					backgroundColor: "var(--bg-secondary)",
					borderLeft: "1px solid var(--border-default)",
					borderRight: "1px solid var(--border-default)",
					borderBottom: "1px solid var(--border-default)",
					color: "var(--text-muted)",
				}}
			>
				No option groups yet. Create them in the Options page first.
			</div>
		);
	}

	return (
		<div
			className="px-3 py-3 rounded-b-lg space-y-2"
			style={{
				backgroundColor: "var(--bg-secondary)",
				borderLeft: "1px solid var(--border-default)",
				borderRight: "1px solid var(--border-default)",
				borderBottom: "1px solid var(--border-default)",
			}}
		>
			<span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
				Linked Option Groups
			</span>
			<div className="flex flex-wrap gap-2">
				{sorted.map((group) => {
					const isLinked = linkedIds.has(group._id);
					return (
						<button
							key={group._id}
							onClick={() => handleToggle(group._id)}
							disabled={linkMutation.isPending || unlinkMutation.isPending}
							className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors disabled:opacity-50"
							style={{
								backgroundColor: isLinked ? "var(--btn-primary-bg)" : "var(--bg-primary)",
								color: isLinked ? "var(--btn-primary-text)" : "var(--text-secondary)",
								border: isLinked ? "1px solid transparent" : "1px solid var(--border-default)",
							}}
						>
							{group.name}
							<span className="ml-1 opacity-70">
								{group.selectionType === "single" ? "· Single" : "· Multi"}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
