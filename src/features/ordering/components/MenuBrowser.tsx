import { StatusBadge } from "@/global/components";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { Check, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

export interface SelectedOption {
	optionGroupId: Id<"optionGroups">;
	optionGroupName: string;
	optionId: Id<"options">;
	optionName: string;
	priceModifier: number;
}

interface ItemSelection {
	quantity: number;
	basePrice: number;
	selectedOptions: Map<string, SelectedOption[]>;
}

interface MenuBrowserProps {
	restaurantId: Id<"restaurants">;
	onSubmitOrder: (data: {
		items: Array<{
			menuItemId: Id<"menuItems">;
			quantity: number;
			selectedOptions: SelectedOption[];
		}>;
		specialInstructions?: string;
	}) => void;
	isSubmitting: boolean;
}

export function MenuBrowser({
	restaurantId,
	onSubmitOrder,
	isSubmitting,
}: Readonly<MenuBrowserProps>) {
	const { data: menus } = useQuery(convexQuery(api.menus.getMenusByRestaurant, { restaurantId }));
	const activeMenus = (menus ?? [])
		.filter((m) => m.isActive)
		.sort((a, b) => a.displayOrder - b.displayOrder);
	const [selectedMenuId, setSelectedMenuId] = useState<Id<"menus"> | null>(null);
	const [selections, setSelections] = useState<Map<string, ItemSelection>>(new Map());
	const [showPayFlow, setShowPayFlow] = useState(false);
	const [comment, setComment] = useState("");

	const currentMenuId = selectedMenuId ?? activeMenus[0]?._id;

	const toggleItem = useCallback((itemId: Id<"menuItems">, basePrice: number) => {
		setSelections((prev) => {
			const next = new Map(prev);
			if (next.has(itemId)) {
				next.delete(itemId);
			} else {
				next.set(itemId, { quantity: 1, basePrice, selectedOptions: new Map() });
			}
			return next;
		});
	}, []);

	const updateItemOptions = useCallback(
		(itemId: Id<"menuItems">, groupId: string, options: SelectedOption[]) => {
			setSelections((prev) => {
				const next = new Map(prev);
				const item = next.get(itemId);
				if (!item) return prev;
				const newOptions = new Map(item.selectedOptions);
				newOptions.set(groupId, options);
				next.set(itemId, { ...item, selectedOptions: newOptions });
				return next;
			});
		},
		[]
	);

	const orderTotal = useMemo(() => {
		let total = 0;
		for (const sel of selections.values()) {
			const optionsTotal = Array.from(sel.selectedOptions.values())
				.flat()
				.reduce((sum, o) => sum + o.priceModifier, 0);
			total += (sel.basePrice + optionsTotal) * sel.quantity;
		}
		return total;
	}, [selections]);

	const itemCount = selections.size;

	const handleConfirmOrder = () => {
		const items = Array.from(selections.entries()).map(([menuItemId, sel]) => ({
			menuItemId: menuItemId as Id<"menuItems">,
			quantity: sel.quantity,
			selectedOptions: Array.from(sel.selectedOptions.values()).flat(),
		}));
		onSubmitOrder({
			items,
			specialInstructions: comment || undefined,
		});
	};

	return (
		<div className="flex flex-col h-full">
			{activeMenus.length > 1 && (
				<div className="flex gap-2 px-4 pt-4 overflow-x-auto">
					{activeMenus.map((menu) => (
						<button
							key={menu._id}
							onClick={() => setSelectedMenuId(menu._id)}
							className={`px-4 py-2 rounded-full text-sm whitespace-nowrap transition-colors ${
								currentMenuId === menu._id ? "font-medium" : ""
							}`}
							style={{
								backgroundColor:
									currentMenuId === menu._id ? "var(--btn-primary-bg)" : "var(--bg-secondary)",
								color: currentMenuId === menu._id ? "white" : "var(--text-secondary)",
							}}
						>
							{menu.name}
						</button>
					))}
				</div>
			)}

			<div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
				{currentMenuId && (
					<MenuCategories
						menuId={currentMenuId}
						selections={selections}
						onToggleItem={toggleItem}
						onUpdateOptions={updateItemOptions}
					/>
				)}
			</div>

			{/* Bottom bar: total + pay */}
			{itemCount > 0 && (
				<div
					className="shrink-0 px-4 pb-4 pt-3 space-y-3"
					style={{
						borderTop: "1px solid var(--border-default)",
						backgroundColor: "var(--bg-primary)",
					}}
				>
					{showPayFlow ? (
						<>
							<div className="flex items-center justify-between">
								<h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
									Order Comment (optional)
								</h3>
								<button
									onClick={() => setShowPayFlow(false)}
									className="p-1 rounded hover:bg-(--bg-hover)"
								>
									<X size={16} style={{ color: "var(--text-muted)" }} />
								</button>
							</div>
							<textarea
								value={comment}
								onChange={(e) => setComment(e.target.value)}
								placeholder="Any allergies, preferences, or notes for the kitchen?"
								rows={2}
								className="w-full px-3 py-2 rounded-lg text-sm"
								style={{
									backgroundColor: "var(--bg-secondary)",
									border: "1px solid var(--border-default)",
									color: "var(--text-primary)",
								}}
							/>
							<div
								className="flex justify-between text-base font-semibold"
								style={{ color: "var(--text-primary)" }}
							>
								<span>Total</span>
								<span>${(orderTotal / 100).toFixed(2)}</span>
							</div>
							<button
								onClick={handleConfirmOrder}
								disabled={isSubmitting}
								className="w-full max-w-sm mx-auto block py-3 rounded-xl text-sm font-medium hover-btn-primary disabled:opacity-50"
							>
								{isSubmitting ? "Placing Order..." : "Confirm Order"}
							</button>
						</>
					) : (
						<>
							<div
								className="flex justify-between text-base font-semibold"
								style={{ color: "var(--text-primary)" }}
							>
								<span>
									Total ({itemCount} {itemCount === 1 ? "item" : "items"})
								</span>
								<span>${(orderTotal / 100).toFixed(2)}</span>
							</div>
							<button
								onClick={() => setShowPayFlow(true)}
								className="w-full max-w-sm mx-auto block py-3 rounded-xl text-sm font-medium hover-btn-primary"
							>
								Pay
							</button>
						</>
					)}
				</div>
			)}
		</div>
	);
}

function MenuCategories({
	menuId,
	selections,
	onToggleItem,
	onUpdateOptions,
}: Readonly<{
	menuId: Id<"menus">;
	selections: Map<string, ItemSelection>;
	onToggleItem: (id: Id<"menuItems">, basePrice: number) => void;
	onUpdateOptions: (itemId: Id<"menuItems">, groupId: string, options: SelectedOption[]) => void;
}>) {
	const { data: categories } = useQuery(convexQuery(api.menus.getCategoriesByMenu, { menuId }));
	const sorted = [...(categories ?? [])].sort((a, b) => a.displayOrder - b.displayOrder);

	return (
		<>
			{sorted.map((cat) => (
				<CategoryItems
					key={cat._id}
					category={cat}
					selections={selections}
					onToggleItem={onToggleItem}
					onUpdateOptions={onUpdateOptions}
				/>
			))}
		</>
	);
}

function CategoryItems({
	category,
	selections,
	onToggleItem,
	onUpdateOptions,
}: Readonly<{
	category: Doc<"menuCategories">;
	selections: Map<string, ItemSelection>;
	onToggleItem: (id: Id<"menuItems">, basePrice: number) => void;
	onUpdateOptions: (itemId: Id<"menuItems">, groupId: string, options: SelectedOption[]) => void;
}>) {
	const { data: items } = useQuery(
		convexQuery(api.menuItems.getByCategory, { categoryId: category._id })
	);

	const now = new Date();
	const dayOfWeek = now.getDay();

	const visibleItems = (items ?? [])
		.filter((item) => {
			if (!item.isAvailable) return false;
			if (item.availableDays && item.availableDays.length > 0) {
				return item.availableDays.includes(dayOfWeek);
			}
			return true;
		})
		.sort((a, b) => a.displayOrder - b.displayOrder);

	if (visibleItems.length === 0) return null;

	return (
		<div>
			<h3 className="text-lg font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
				{category.name}
			</h3>
			<div className="space-y-2">
				{visibleItems.map((item) => {
					const isSelected = selections.has(item._id);
					const selection = selections.get(item._id);
					return (
						<div key={item._id}>
							<button
								onClick={() => onToggleItem(item._id, item.basePrice)}
								className="w-full text-left flex justify-between items-center px-4 py-3 rounded-xl transition-colors"
								style={{
									backgroundColor: isSelected ? "var(--bg-active, #e0e7ff)" : "var(--bg-secondary)",
									border: isSelected ? "1px solid var(--btn-primary-bg)" : "1px solid transparent",
								}}
							>
								<div className="flex items-center gap-3 flex-1 pr-4">
									<div
										className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors"
										style={{
											backgroundColor: isSelected ? "var(--btn-primary-bg)" : "transparent",
											border: isSelected ? "none" : "2px solid var(--border-default)",
										}}
									>
										{isSelected && <Check size={12} color="white" strokeWidth={3} />}
									</div>
									<div className="flex-1">
										<div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
											{item.name}
										</div>
										{item.description && (
											<div
												className="text-xs mt-0.5 line-clamp-2"
												style={{ color: "var(--text-muted)" }}
											>
												{item.description}
											</div>
										)}
									</div>
								</div>
								<span
									className="text-sm font-medium whitespace-nowrap"
									style={{ color: "var(--text-primary)" }}
								>
									${(item.basePrice / 100).toFixed(2)}
								</span>
							</button>

							{isSelected && selection && (
								<InlineOptionGroups
									itemId={item._id}
									selection={selection}
									onUpdateOptions={onUpdateOptions}
								/>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function InlineOptionGroups({
	itemId,
	selection,
	onUpdateOptions,
}: Readonly<{
	itemId: Id<"menuItems">;
	selection: ItemSelection;
	onUpdateOptions: (itemId: Id<"menuItems">, groupId: string, options: SelectedOption[]) => void;
}>) {
	const { data: optionGroups } = useQuery(
		convexQuery(api.optionGroups.getGroupsForMenuItem, { menuItemId: itemId })
	);

	const groups = optionGroups ?? [];
	if (groups.length === 0) return null;

	return (
		<div
			className="ml-8 mt-1 mb-2 space-y-3 px-3 py-3 rounded-lg"
			style={{
				backgroundColor: "var(--bg-secondary)",
				borderLeft: "2px solid var(--btn-primary-bg)",
			}}
		>
			{groups.map((group: any) => (
				<OptionGroupSection
					key={group._id}
					group={group}
					groupSelections={selection.selectedOptions.get(group._id) ?? []}
					onSelect={(updated) => onUpdateOptions(itemId, group._id, updated)}
				/>
			))}
		</div>
	);
}

function OptionGroupSection({
	group,
	groupSelections,
	onSelect,
}: Readonly<{
	group: any;
	groupSelections: SelectedOption[];
	onSelect: (updated: SelectedOption[]) => void;
}>) {
	const handleOptionClick = (opt: any, isOptSelected: boolean) => {
		const newOpt: SelectedOption = {
			optionGroupId: group._id,
			optionGroupName: group.name,
			optionId: opt._id,
			optionName: opt.name,
			priceModifier: opt.priceModifier,
		};
		let updated: SelectedOption[];
		if (group.selectionType === "single") {
			updated = isOptSelected ? [] : [newOpt];
		} else if (isOptSelected) {
			updated = groupSelections.filter((s) => s.optionId !== opt._id);
		} else {
			updated = [...groupSelections, newOpt];
		}
		onSelect(updated);
	};

	return (
		<div>
			<div className="flex items-center gap-2 mb-1.5">
				<span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
					{group.name}
				</span>
				{group.isRequired && (
					<StatusBadge
						bgColor="var(--accent-warning-light, #fef3c7)"
						textColor="var(--accent-warning, #d97706)"
						label="Required"
						className="text-[10px]"
					/>
				)}
				{group.selectionType === "single" && (
					<span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
						Pick one
					</span>
				)}
			</div>
			<div className="space-y-1">
				{(group.options ?? [])
					.filter((o: any) => o.isAvailable)
					.map((opt: any) => {
						const isOptSelected = groupSelections.some((s) => s.optionId === opt._id);
						return (
							<button
								key={opt._id}
								onClick={() => handleOptionClick(opt, isOptSelected)}
								className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-colors"
								style={{
									backgroundColor: isOptSelected
										? "var(--bg-active, #e0e7ff)"
										: "var(--bg-primary)",
									border: `1px solid ${isOptSelected ? "var(--btn-primary-bg)" : "var(--border-default)"}`,
									color: "var(--text-primary)",
								}}
							>
								<span>{opt.name}</span>
								{opt.priceModifier > 0 && (
									<span style={{ color: "var(--text-muted)" }}>
										+${(opt.priceModifier / 100).toFixed(2)}
									</span>
								)}
							</button>
						);
					})}
			</div>
		</div>
	);
}
