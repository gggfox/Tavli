import { OrderingKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import { getTranslatedField } from "@/global/utils/translations";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { Check, UtensilsCrossed, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SelectedOption } from "../types";
import { ItemDetailSheet } from "./ItemDetailSheet";

export type { SelectedOption } from "../types";

interface ItemSelection {
	quantity: number;
	basePrice: number;
	selectedOptions: Map<string, SelectedOption[]>;
}

interface MenuBrowserProps {
	restaurantId: Id<"restaurants">;
	lang?: string;
	onSubmitOrder: (data: {
		items: Array<{
			menuItemId: Id<"menuItems">;
			quantity: number;
			selectedOptions: SelectedOption[];
		}>;
		specialInstructions?: string;
		tableId: Id<"tables">;
	}) => void;
	isSubmitting: boolean;
}

export function MenuBrowser({
	restaurantId,
	lang,
	onSubmitOrder,
	isSubmitting,
}: Readonly<MenuBrowserProps>) {
	const { t } = useTranslation();
	const { data: paymentsEnabled } = useQuery(
		convexQuery(api.restaurants.getPaymentsEnabled, { restaurantId })
	);
	const { data: menus } = useQuery(convexQuery(api.menus.getMenusByRestaurant, { restaurantId }));
	const activeMenus = (menus ?? [])
		.filter((m) => m.isActive)
		.sort((a, b) => a.displayOrder - b.displayOrder);
	const [selectedMenuId, setSelectedMenuId] = useState<Id<"menus"> | null>(null);
	const [selections, setSelections] = useState<Map<string, ItemSelection>>(new Map());
	const [showPayFlow, setShowPayFlow] = useState(false);
	const [comment, setComment] = useState("");
	const [selectedTableId, setSelectedTableId] = useState<Id<"tables"> | null>(null);
	const [detailItem, setDetailItem] = useState<Doc<"menuItems"> | null>(null);

	const { data: tables } = useQuery(
		convexQuery(api.tables.getActiveByRestaurant, { restaurantId })
	);

	const currentMenuId = selectedMenuId ?? activeMenus[0]?._id;

	const handleOpenDetail = useCallback((item: Doc<"menuItems">) => {
		setDetailItem(item);
	}, []);

	const handleAddOrUpdate = useCallback(
		(data: {
			menuItemId: Id<"menuItems">;
			quantity: number;
			basePrice: number;
			selectedOptions: Map<string, SelectedOption[]>;
		}) => {
			setSelections((prev) => {
				const next = new Map(prev);
				next.set(data.menuItemId, {
					quantity: data.quantity,
					basePrice: data.basePrice,
					selectedOptions: data.selectedOptions,
				});
				return next;
			});
			setDetailItem(null);
		},
		[]
	);

	const handleRemoveItem = useCallback((itemId: Id<"menuItems">) => {
		setSelections((prev) => {
			const next = new Map(prev);
			next.delete(itemId);
			return next;
		});
		setDetailItem(null);
	}, []);

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
		if (!selectedTableId) return;
		const items = Array.from(selections.entries()).map(([menuItemId, sel]) => ({
			menuItemId: menuItemId as Id<"menuItems">,
			quantity: sel.quantity,
			selectedOptions: Array.from(sel.selectedOptions.values()).flat(),
		}));
		onSubmitOrder({
			items,
			specialInstructions: comment || undefined,
			tableId: selectedTableId,
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
							style={{backgroundColor:
									currentMenuId === menu._id ? "var(--btn-primary-bg)" : "var(--bg-secondary)",
				color: currentMenuId === menu._id ? "white" : "var(--text-secondary)"}}
						>
							{getTranslatedField(menu, lang)}
						</button>
					))}
				</div>
			)}

			<div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
				{currentMenuId && (
					<MenuCategories
						menuId={currentMenuId}
						lang={lang}
						selections={selections}
						onOpenDetail={handleOpenDetail}
					/>
				)}
			</div>

			{/* Bottom bar: total + pay */}
			{paymentsEnabled === false && itemCount > 0 && (
				<div
					className="shrink-0 px-4 py-3 text-center text-sm border-t border-border text-warning"
					style={{backgroundColor: "rgba(217, 119, 6, 0.1)"}}
				>
					{t(OrderingKeys.MENU_NO_ONLINE_ORDERING)}
				</div>
			)}
			{itemCount === 0 && (
				<div
					className="shrink-0 px-4 py-4 text-center border-t border-border bg-background text-faint-foreground"
					
				>
					<p className="text-sm">{t(OrderingKeys.MENU_TAP_TO_START)}</p>
				</div>
			)}
			{itemCount > 0 && (
				<div
					className="shrink-0 px-4 pb-4 pt-3 space-y-3 border-t border-border bg-background"
					
				>
					{showPayFlow ? (
						<>
							<div className="flex items-center justify-between">
								<h3 className="text-sm font-semibold text-foreground" >
									{t(OrderingKeys.MENU_REVIEW_ORDER)}
								</h3>
								<button
									onClick={() => setShowPayFlow(false)}
									className="p-1 rounded hover:bg-(--bg-hover) text-faint-foreground"
								>
									<X size={16}  />
								</button>
							</div>

							<div>
								<label
									htmlFor="table-select"
									className="block text-xs font-semibold mb-1 text-muted-foreground"
									
								>
									{t(OrderingKeys.MENU_TABLE_NUMBER)}{" "}
									<span style={{color: "#dc2626"}}>*</span>
								</label>
								<select
									id="table-select"
									value={selectedTableId ?? ""}
									onChange={(e) =>
										setSelectedTableId(e.target.value ? (e.target.value as Id<"tables">) : null)
									}
									className="w-full px-3 py-2 rounded-lg text-sm bg-muted text-foreground"
									style={{border: `1px solid ${!selectedTableId && showPayFlow ? "#fca5a5" : "var(--border-default)"}`}}
								>
									<option value="">{t(OrderingKeys.MENU_SELECT_TABLE)}</option>
									{(tables ?? [])
										.sort((a, b) => a.tableNumber - b.tableNumber)
										.map((tab) => (
											<option key={tab._id} value={tab._id}>
												{t(OrderingKeys.MENU_TABLE_LABEL, { number: tab.tableNumber })}
												{tab.label ? ` – ${tab.label}` : ""}
											</option>
										))}
								</select>
								{!selectedTableId && (
									<p className="text-[11px] mt-1" style={{color: "#dc2626"}}>
										{t(OrderingKeys.MENU_TABLE_REQUIRED)}
									</p>
								)}
							</div>

							<textarea
								value={comment}
								onChange={(e) => setComment(e.target.value)}
								placeholder={t(OrderingKeys.MENU_NOTES_PLACEHOLDER)}
								rows={2}
								className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
								
							/>
							<div
								className="flex justify-between text-base font-semibold text-foreground"
								
							>
								<span>{t(OrderingKeys.MENU_TOTAL_LABEL)}</span>
								<span>${formatCents(orderTotal)}</span>
							</div>
							<button
								onClick={handleConfirmOrder}
								disabled={isSubmitting || !selectedTableId || paymentsEnabled === false}
								className="w-full max-w-sm mx-auto block py-3 rounded-xl text-sm font-medium hover-btn-primary disabled:opacity-50"
							>
								{isSubmitting
									? t(OrderingKeys.MENU_PREPARING)
									: t(OrderingKeys.MENU_PROCEED_TO_PAYMENT)}
							</button>
						</>
					) : (
						<>
							<div
								className="flex justify-between text-base font-semibold text-foreground"
								
							>
								<span>{t(OrderingKeys.MENU_TOTAL_WITH_COUNT, { count: itemCount })}</span>
								<span>${formatCents(orderTotal)}</span>
							</div>
							<button
								onClick={() => setShowPayFlow(true)}
								disabled={paymentsEnabled === false}
								className="w-full max-w-sm mx-auto block py-3 rounded-xl text-sm font-medium hover-btn-primary disabled:opacity-50"
							>
								{t(OrderingKeys.MENU_PROCEED_TO_PAYMENT)}
							</button>
						</>
					)}
				</div>
			)}

			{/* Item detail bottom sheet */}
			{detailItem && (
				<ItemDetailSheet
					item={detailItem}
					lang={lang}
					existingSelection={
						selections.has(detailItem._id) ? selections.get(detailItem._id) : undefined
					}
					onAddToCart={handleAddOrUpdate}
					onRemove={
						selections.has(detailItem._id) ? () => handleRemoveItem(detailItem._id) : undefined
					}
					onClose={() => setDetailItem(null)}
				/>
			)}
		</div>
	);
}

function MenuCategories({
	menuId,
	lang,
	selections,
	onOpenDetail,
}: Readonly<{
	menuId: Id<"menus">;
	lang?: string;
	selections: Map<string, ItemSelection>;
	onOpenDetail: (item: Doc<"menuItems">) => void;
}>) {
	const { data: categories } = useQuery(convexQuery(api.menus.getCategoriesByMenu, { menuId }));
	const sorted = [...(categories ?? [])].sort((a, b) => a.displayOrder - b.displayOrder);

	return (
		<>
			{sorted.map((cat) => (
				<CategoryItems
					key={cat._id}
					category={cat}
					lang={lang}
					selections={selections}
					onOpenDetail={onOpenDetail}
				/>
			))}
		</>
	);
}

function CategoryItems({
	category,
	lang,
	selections,
	onOpenDetail,
}: Readonly<{
	category: Doc<"menuCategories">;
	lang?: string;
	selections: Map<string, ItemSelection>;
	onOpenDetail: (item: Doc<"menuItems">) => void;
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
			<h3 className="text-lg font-semibold mb-3 text-foreground" >
				{getTranslatedField(category, lang)}
			</h3>
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
				{visibleItems.map((item) => {
					const isSelected = selections.has(item._id);
					const selection = selections.get(item._id);
					const description = getTranslatedField(item, lang, "description") || item.description;
					return (
						<button
							key={item._id}
							onClick={() => onOpenDetail(item)}
							className="relative w-full text-left rounded-xl transition-colors overflow-hidden flex flex-col"
							style={{backgroundColor: isSelected ? "var(--bg-active)" : "var(--bg-secondary)",
				border: isSelected ? "2px solid var(--btn-primary-bg)" : "2px solid transparent"}}
						>
							{isSelected && (
								<span
									className="absolute top-2 right-2 z-10 w-6 h-6 flex items-center justify-center rounded-full bg-primary"
									
								>
									<Check size={14} className="text-white" />
								</span>
							)}
							{isSelected && selection && selection.quantity > 1 && (
								<span
									className="absolute top-2 left-2 z-10 w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold text-white bg-primary"
									
								>
									{selection.quantity}
								</span>
							)}
							{item.imageUrl ? (
								<img
									src={item.imageUrl}
									alt={getTranslatedField(item, lang)}
									className="w-full h-36 sm:h-40 object-cover"
								/>
							) : (
								<div
									className="w-full h-36 sm:h-40 flex items-center justify-center bg-background"
									
								>
									<UtensilsCrossed size={48} className="text-faint-foreground"  />
								</div>
							)}
							<div className="px-3 py-2.5 mt-auto">
								<div className="text-sm font-medium text-foreground" >
									{getTranslatedField(item, lang)}
								</div>
								{description && (
									<div
										className="text-xs mt-0.5 line-clamp-2 text-faint-foreground"
										
									>
										{description}
									</div>
								)}
								<div className="text-sm font-bold mt-1 text-foreground" >
									${formatCents(item.basePrice)}
								</div>
							</div>
						</button>
					);
				})}
			</div>
		</div>
	);
}
