import { StatusBadge } from "@/global/components";
import { OrderingKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { ArrowLeft, Minus, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SelectedOption } from "../types";
import { toggleOptionSelection } from "../utils";
import { MenuItemDetailSkeleton } from "./MenuItemDetailSkeleton";

interface MenuItemDetailProps {
	itemId: Id<"menuItems">;
	onBack: () => void;
	onAddToCart: (data: {
		menuItemId: Id<"menuItems">;
		quantity: number;
		selectedOptions: SelectedOption[];
		specialInstructions?: string;
	}) => void;
}

export function MenuItemDetail({ itemId, onBack, onAddToCart }: Readonly<MenuItemDetailProps>) {
	const { t } = useTranslation();
	const { data: menuItem } = useQuery(convexQuery(api.menuItems.getById, { itemId }));
	const { data: optionGroups } = useQuery(
		convexQuery(api.optionGroups.getGroupsForMenuItem, { menuItemId: itemId })
	);

	const [quantity, setQuantity] = useState(1);
	const [selectedOptions, setSelectedOptions] = useState<Map<string, SelectedOption[]>>(new Map());
	const [instructions, setInstructions] = useState("");

	const allSelected = Array.from(selectedOptions.values()).flat();
	const optionsTotal = allSelected.reduce((sum, o) => sum + o.priceModifier, 0);
	const itemTotal = menuItem ? (menuItem.basePrice + optionsTotal) * quantity : 0;

	const handleOptionToggle = (
		groupId: Id<"optionGroups">,
		groupName: string,
		optionId: Id<"options">,
		optionName: string,
		priceModifier: number,
		selectionType: "single" | "multi"
	) => {
		setSelectedOptions((prev) => {
			const next = new Map(prev);
			const current = next.get(groupId) ?? [];
			const opt: SelectedOption = {
				optionGroupId: groupId,
				optionGroupName: groupName,
				optionId,
				optionName,
				priceModifier,
			};
			next.set(groupId, toggleOptionSelection(current, opt, selectionType));
			return next;
		});
	};

	const handleAdd = () => {
		if (!menuItem) return;
		onAddToCart({
			menuItemId: itemId,
			quantity,
			selectedOptions: allSelected,
			specialInstructions: instructions || undefined,
		});
	};

	if (!menuItem) {
		return <MenuItemDetailSkeleton onBack={onBack} />;
	}

	return (
		<div className="flex flex-col h-full">
			<div className="flex-1 overflow-y-auto p-4 space-y-6">
				<button
					onClick={onBack}
					className="flex items-center gap-1 text-sm text-primary"
					
				>
					<ArrowLeft size={16} /> {t(OrderingKeys.BACK_TO_MENU)}
				</button>

				<div>
					<h2 className="text-xl font-bold text-foreground" >
						{menuItem.name}
					</h2>
					{menuItem.description && (
						<p className="text-sm mt-1 text-muted-foreground" >
							{menuItem.description}
						</p>
					)}
					<p className="text-lg font-semibold mt-2 text-foreground" >
						${formatCents(menuItem.basePrice)}
					</p>
				</div>

				{/* Option groups */}
				{(optionGroups ?? []).map((group: any) => {
					const groupSelections = selectedOptions.get(group._id) ?? [];
					return (
						<div key={group._id}>
							<div className="flex items-center gap-2 mb-2">
								<h3 className="text-sm font-semibold text-foreground" >
									{group.name}
								</h3>
								{group.isRequired && (
									<StatusBadge
										bgColor="var(--accent-warning-light)"
										textColor="var(--accent-warning)"
										label={t(OrderingKeys.ITEM_REQUIRED)}
									/>
								)}
							</div>
							<div className="space-y-1">
								{(group.options ?? [])
									.filter((o: any) => o.isAvailable)
									.map((opt: any) => {
										const isSelected = groupSelections.some((s) => s.optionId === opt._id);
										return (
											<button
												key={opt._id}
												onClick={() =>
													handleOptionToggle(
														group._id,
														group.name,
														opt._id,
														opt.name,
														opt.priceModifier,
														group.selectionType
													)
												}
												className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors text-foreground"
												style={{backgroundColor: isSelected
														? "var(--bg-active)"
														: "var(--bg-secondary)",
				border: `1px solid ${isSelected ? "var(--btn-primary-bg)" : "var(--border-default)"}`}}
											>
												<span>{opt.name}</span>
												{opt.priceModifier > 0 && (
													<span className="text-faint-foreground" >
														+${formatCents(opt.priceModifier)}
													</span>
												)}
											</button>
										);
									})}
							</div>
						</div>
					);
				})}

				{/* Special instructions */}
				<div>
					<label
						htmlFor="special-instructions"
						className="text-sm font-medium text-foreground"
						
					>
						{t(OrderingKeys.ITEM_SPECIAL_INSTRUCTIONS_LABEL)}
					</label>
					<textarea
						id="special-instructions"
						value={instructions}
						onChange={(e) => setInstructions(e.target.value)}
						placeholder={t(OrderingKeys.ITEM_SPECIAL_INSTRUCTIONS_PLACEHOLDER)}
						rows={2}
						className="w-full mt-1 px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
						
					/>
				</div>
			</div>

			{/* Bottom bar */}
			<div
				className="px-4 pb-4 pt-2 space-y-3 border-t border-border"
				
			>
				<div className="flex items-center justify-center gap-4">
					<button
						onClick={() => setQuantity(Math.max(1, quantity - 1))}
						className="p-2 rounded-full bg-muted border border-border"
						
					>
						<Minus size={16} />
					</button>
					<span
						className="text-lg font-medium w-8 text-center text-foreground"
						
					>
						{quantity}
					</span>
					<button
						onClick={() => setQuantity(quantity + 1)}
						className="p-2 rounded-full bg-muted border border-border"
						
					>
						<Plus size={16} />
					</button>
				</div>
				<button
					onClick={handleAdd}
					className="w-full py-3 rounded-xl text-sm font-medium hover-btn-primary"
				>
					{t(OrderingKeys.ITEM_ADD_TO_CART)} - ${formatCents(itemTotal)}
				</button>
			</div>
		</div>
	);
}
