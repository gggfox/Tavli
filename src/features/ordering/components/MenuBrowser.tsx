import { StatusBadge } from "@/global/components";
import { formatCents } from "@/global/utils/money";
import { getTranslatedField } from "@/global/utils/translations";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { Check, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SelectedOption } from "../types";
import { toggleOptionSelection } from "../utils";

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
	const { data: menus } = useQuery(convexQuery(api.menus.getMenusByRestaurant, { restaurantId }));
	const activeMenus = (menus ?? [])
		.filter((m) => m.isActive)
		.sort((a, b) => a.displayOrder - b.displayOrder);
	const [selectedMenuId, setSelectedMenuId] = useState<Id<"menus"> | null>(null);
	const [selections, setSelections] = useState<Map<string, ItemSelection>>(new Map());
	const [showPayFlow, setShowPayFlow] = useState(false);
	const [comment, setComment] = useState("");
	const [selectedTableId, setSelectedTableId] = useState<Id<"tables"> | null>(null);

	const { data: tables } = useQuery(
		convexQuery(api.tables.getActiveByRestaurant, { restaurantId })
	);
	const [validationErrors, setValidationErrors] = useState<Map<string, string[]>>(new Map());

	const currentMenuId = selectedMenuId ?? activeMenus[0]?._id;

	const hasValidationErrors = useMemo(
		() => Array.from(validationErrors.values()).some((groups) => groups.length > 0),
		[validationErrors]
	);

	const onValidationChange = useCallback((itemId: Id<"menuItems">, missingGroups: string[]) => {
		setValidationErrors((prev) => {
			const next = new Map(prev);
			if (missingGroups.length === 0) {
				next.delete(itemId);
			} else {
				next.set(itemId, missingGroups);
			}
			return next;
		});
	}, []);

	const toggleItem = useCallback((itemId: Id<"menuItems">, basePrice: number) => {
		setSelections((prev) => {
			const next = new Map(prev);
			if (next.has(itemId)) {
				next.delete(itemId);
				setValidationErrors((ve) => {
					const nve = new Map(ve);
					nve.delete(itemId);
					return nve;
				});
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
							style={{
								backgroundColor:
									currentMenuId === menu._id ? "var(--btn-primary-bg)" : "var(--bg-secondary)",
								color: currentMenuId === menu._id ? "white" : "var(--text-secondary)",
							}}
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
						onToggleItem={toggleItem}
						onUpdateOptions={updateItemOptions}
						onValidationChange={onValidationChange}
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
									Confirm Your Order
								</h3>
								<button
									onClick={() => setShowPayFlow(false)}
									className="p-1 rounded hover:bg-(--bg-hover)"
								>
									<X size={16} style={{ color: "var(--text-muted)" }} />
								</button>
							</div>

							<div>
								<label
									htmlFor="table-select"
									className="block text-xs font-semibold mb-1"
									style={{ color: "var(--text-secondary)" }}
								>
									Table Number <span style={{ color: "#dc2626" }}>*</span>
								</label>
								<select
									id="table-select"
									value={selectedTableId ?? ""}
									onChange={(e) =>
										setSelectedTableId(e.target.value ? (e.target.value as Id<"tables">) : null)
									}
									className="w-full px-3 py-2 rounded-lg text-sm"
									style={{
										backgroundColor: "var(--bg-secondary)",
										border: `1px solid ${!selectedTableId && showPayFlow ? "#fca5a5" : "var(--border-default)"}`,
										color: "var(--text-primary)",
									}}
								>
									<option value="">Select your table</option>
									{(tables ?? [])
										.sort((a, b) => a.tableNumber - b.tableNumber)
										.map((t) => (
											<option key={t._id} value={t._id}>
												Table {t.tableNumber}
												{t.label ? ` – ${t.label}` : ""}
											</option>
										))}
								</select>
								{!selectedTableId && (
									<p className="text-[11px] mt-1" style={{ color: "#dc2626" }}>
										Please select a table to continue
									</p>
								)}
							</div>

							<textarea
								value={comment}
								onChange={(e) => setComment(e.target.value)}
								placeholder="Any allergies, preferences, or notes for the kitchen? (optional)"
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
								<span>${formatCents(orderTotal)}</span>
							</div>
							<button
								onClick={handleConfirmOrder}
								disabled={isSubmitting || hasValidationErrors || !selectedTableId}
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
								<span>${formatCents(orderTotal)}</span>
							</div>
							{hasValidationErrors && (
								<p className="text-xs text-center" style={{ color: "#dc2626" }}>
									Please complete all required options
								</p>
							)}
							<button
								onClick={() => setShowPayFlow(true)}
								disabled={hasValidationErrors}
								className="w-full max-w-sm mx-auto block py-3 rounded-xl text-sm font-medium hover-btn-primary disabled:opacity-50"
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
	lang,
	selections,
	onToggleItem,
	onUpdateOptions,
	onValidationChange,
}: Readonly<{
	menuId: Id<"menus">;
	lang?: string;
	selections: Map<string, ItemSelection>;
	onToggleItem: (id: Id<"menuItems">, basePrice: number) => void;
	onUpdateOptions: (itemId: Id<"menuItems">, groupId: string, options: SelectedOption[]) => void;
	onValidationChange: (itemId: Id<"menuItems">, missingGroups: string[]) => void;
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
					onToggleItem={onToggleItem}
					onUpdateOptions={onUpdateOptions}
					onValidationChange={onValidationChange}
				/>
			))}
		</>
	);
}

function CategoryItems({
	category,
	lang,
	selections,
	onToggleItem,
	onUpdateOptions,
	onValidationChange,
}: Readonly<{
	category: Doc<"menuCategories">;
	lang?: string;
	selections: Map<string, ItemSelection>;
	onToggleItem: (id: Id<"menuItems">, basePrice: number) => void;
	onUpdateOptions: (itemId: Id<"menuItems">, groupId: string, options: SelectedOption[]) => void;
	onValidationChange: (itemId: Id<"menuItems">, missingGroups: string[]) => void;
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
				{getTranslatedField(category, lang)}
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
									{item.imageUrl && (
										<img
											src={item.imageUrl}
											alt={getTranslatedField(item, lang)}
											className="w-12 h-12 rounded-lg object-cover shrink-0"
										/>
									)}
									<div className="flex-1">
										<div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
											{getTranslatedField(item, lang)}
										</div>
										{(getTranslatedField(item, lang, "description") || item.description) && (
											<div
												className="text-xs mt-0.5 line-clamp-2"
												style={{ color: "var(--text-muted)" }}
											>
												{getTranslatedField(item, lang, "description") || item.description}
											</div>
										)}
									</div>
								</div>
								<span
									className="text-sm font-medium whitespace-nowrap"
									style={{ color: "var(--text-primary)" }}
								>
									${formatCents(item.basePrice)}
								</span>
							</button>

							{isSelected && selection && (
								<InlineOptionGroups
									itemId={item._id}
									lang={lang}
									selection={selection}
									onUpdateOptions={onUpdateOptions}
									onValidationChange={onValidationChange}
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
	lang,
	selection,
	onUpdateOptions,
	onValidationChange,
}: Readonly<{
	itemId: Id<"menuItems">;
	lang?: string;
	selection: ItemSelection;
	onUpdateOptions: (itemId: Id<"menuItems">, groupId: string, options: SelectedOption[]) => void;
	onValidationChange: (itemId: Id<"menuItems">, missingGroups: string[]) => void;
}>) {
	const { data: optionGroups } = useQuery(
		convexQuery(api.optionGroups.getGroupsForMenuItem, { menuItemId: itemId })
	);

	const groups = optionGroups ?? [];

	const missingGroups = useMemo(() => {
		return groups
			.filter((g: any) => {
				if (!g.isRequired) return false;
				const selected = selection.selectedOptions.get(g._id) ?? [];
				const min = g.minSelections > 0 ? g.minSelections : 1;
				return selected.length < min;
			})
			.map((g: any) => g.name as string);
	}, [groups, selection.selectedOptions]);

	const missingGroupIds = useMemo(() => {
		return new Set(
			groups
				.filter((g: any) => {
					if (!g.isRequired) return false;
					const selected = selection.selectedOptions.get(g._id) ?? [];
					const min = g.minSelections > 0 ? g.minSelections : 1;
					return selected.length < min;
				})
				.map((g: any) => g._id as string)
		);
	}, [groups, selection.selectedOptions]);

	useEffect(() => {
		onValidationChange(itemId, missingGroups);
	}, [itemId, missingGroups, onValidationChange]);

	useEffect(() => {
		return () => onValidationChange(itemId, []);
	}, [itemId, onValidationChange]);

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
					lang={lang}
					groupSelections={selection.selectedOptions.get(group._id) ?? []}
					onSelect={(updated) => onUpdateOptions(itemId, group._id, updated)}
					hasError={missingGroupIds.has(group._id)}
				/>
			))}
		</div>
	);
}

function optionBorderColor(isSelected: boolean, hasError: boolean): string {
	if (isSelected) return "var(--btn-primary-bg)";
	if (hasError) return "#fca5a5";
	return "var(--border-default)";
}

function OptionGroupSection({
	group,
	lang,
	groupSelections,
	onSelect,
	hasError,
}: Readonly<{
	group: any;
	lang?: string;
	groupSelections: SelectedOption[];
	onSelect: (updated: SelectedOption[]) => void;
	hasError: boolean;
}>) {
	const handleOptionClick = (opt: any) => {
		const newOpt: SelectedOption = {
			optionGroupId: group._id,
			optionGroupName: getTranslatedField(group, lang),
			optionId: opt._id,
			optionName: getTranslatedField(opt, lang),
			priceModifier: opt.priceModifier,
		};
		onSelect(toggleOptionSelection(groupSelections, newOpt, group.selectionType));
	};

	return (
		<div>
			<div className="flex items-center gap-2 mb-1.5">
				<span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
					{getTranslatedField(group, lang)}
				</span>
				{group.isRequired && (
					<StatusBadge
						bgColor={hasError ? "#fef2f2" : "var(--accent-warning-light, #fef3c7)"}
						textColor={hasError ? "#dc2626" : "var(--accent-warning, #d97706)"}
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
			{hasError && (
				<p className="text-[11px] mb-1.5" style={{ color: "#dc2626" }}>
					Please select an option
				</p>
			)}
			<div className="space-y-1">
				{(group.options ?? [])
					.filter((o: any) => o.isAvailable)
					.map((opt: any) => {
						const isOptSelected = groupSelections.some((s) => s.optionId === opt._id);
						return (
							<button
								key={opt._id}
								onClick={() => handleOptionClick(opt)}
								className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-colors"
								style={{
									backgroundColor: isOptSelected
										? "var(--bg-active, #e0e7ff)"
										: "var(--bg-primary)",
									border: `1px solid ${optionBorderColor(isOptSelected, hasError)}`,
									color: "var(--text-primary)",
								}}
							>
								<span>{getTranslatedField(opt, lang)}</span>
								{opt.priceModifier > 0 && (
									<span style={{ color: "var(--text-muted)" }}>
										+${formatCents(opt.priceModifier)}
									</span>
								)}
							</button>
						);
					})}
			</div>
		</div>
	);
}
