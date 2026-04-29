import { StatusBadge } from "@/global/components";
import { Modal } from "@/global/components/Modal/Modal";
import { OrderingKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import { getTranslatedField } from "@/global/utils/translations";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { Check, Minus, Plus, Trash2, UtensilsCrossed, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SelectedOption } from "../types";
import { toggleOptionSelection } from "../utils";

function optionBorderColor(isSelected: boolean, hasError: boolean): string {
	if (isSelected) return "var(--btn-primary-bg)";
	if (hasError) return "#fca5a5";
	return "var(--border-default)";
}

interface ItemDetailSheetProps {
	item: Doc<"menuItems">;
	lang?: string;
	existingSelection?: {
		quantity: number;
		selectedOptions: Map<string, SelectedOption[]>;
	};
	onAddToCart: (data: {
		menuItemId: Id<"menuItems">;
		quantity: number;
		basePrice: number;
		selectedOptions: Map<string, SelectedOption[]>;
	}) => void;
	onRemove?: () => void;
	onClose: () => void;
}

export function ItemDetailSheet({
	item,
	lang,
	existingSelection,
	onAddToCart,
	onRemove,
	onClose,
}: Readonly<ItemDetailSheetProps>) {
	const { t } = useTranslation();
	const isEditing = !!existingSelection;

	const { data: optionGroups } = useQuery(
		convexQuery(api.optionGroups.getGroupsForMenuItem, { menuItemId: item._id })
	);

	const [quantity, setQuantity] = useState(existingSelection?.quantity ?? 1);
	const [selectedOptions, setSelectedOptions] = useState<Map<string, SelectedOption[]>>(
		() => existingSelection?.selectedOptions ?? new Map()
	);

	const groups = optionGroups ?? [];

	const missingRequiredGroups = useMemo(() => {
		return groups.filter((g: any) => {
			if (!g.isRequired) return false;
			const selected = selectedOptions.get(g._id) ?? [];
			const min = g.minSelections > 0 ? g.minSelections : 1;
			return selected.length < min;
		});
	}, [groups, selectedOptions]);

	const [showErrors, setShowErrors] = useState(false);

	const allSelected = useMemo(() => Array.from(selectedOptions.values()).flat(), [selectedOptions]);
	const optionsTotal = allSelected.reduce((sum, o) => sum + o.priceModifier, 0);
	const lineTotal = (item.basePrice + optionsTotal) * quantity;

	const handleOptionToggle = (group: any, opt: any) => {
		const newOpt: SelectedOption = {
			optionGroupId: group._id,
			optionGroupName: getTranslatedField(group, lang),
			optionId: opt._id,
			optionName: getTranslatedField(opt, lang),
			priceModifier: opt.priceModifier,
		};
		setSelectedOptions((prev) => {
			const next = new Map(prev);
			const current = next.get(group._id) ?? [];
			next.set(group._id, toggleOptionSelection(current, newOpt, group.selectionType));
			return next;
		});
	};

	const handleSubmit = () => {
		if (missingRequiredGroups.length > 0) {
			setShowErrors(true);
			return;
		}
		onAddToCart({
			menuItemId: item._id,
			quantity,
			basePrice: item.basePrice,
			selectedOptions,
		});
	};

	const description = getTranslatedField(item, lang, "description") || item.description;

	return (
		<Modal
			isOpen
			onClose={onClose}
			ariaLabel={getTranslatedField(item, lang)}
			size="md"
			containerClassName="!mt-auto !mb-0 !mx-0 !max-w-full sm:!my-auto sm:!mx-auto sm:!max-w-md !max-h-[90vh] sm:!max-h-[85vh]"
		>
			<div
				className="flex flex-col rounded-t-2xl sm:rounded-2xl overflow-hidden max-h-[90vh] sm:max-h-[85vh] animate-slide-up bg-background"
				
			>
				{/* Header image / close button */}
				<div className="relative shrink-0">
					{item.imageUrl ? (
						<img
							src={item.imageUrl}
							alt={getTranslatedField(item, lang)}
							className="w-full h-48 sm:h-56 object-cover"
						/>
					) : (
						<div
							className="w-full h-32 flex items-center justify-center bg-muted"
							
						>
							<UtensilsCrossed size={48} className="text-faint-foreground"  />
						</div>
					)}
					<button
						onClick={onClose}
						className="absolute top-3 right-3 p-1.5 rounded-full backdrop-blur-sm"
						style={{backgroundColor: "rgba(0,0,0,0.5)"}}
					>
						<X size={20} className="text-white" />
					</button>
				</div>

				{/* Scrollable content */}
				<div className="flex-1 overflow-y-auto px-4 pt-4 pb-2 space-y-4">
					{/* Item info */}
					<div>
						<h2 className="text-lg font-bold text-foreground" >
							{getTranslatedField(item, lang)}
						</h2>
						{description && (
							<p className="text-sm mt-1 text-muted-foreground" >
								{description}
							</p>
						)}
						<p className="text-base font-semibold mt-1.5 text-foreground" >
							${formatCents(item.basePrice)}
						</p>
					</div>

					{/* Option groups */}
					{groups.map((group: any) => {
						const groupSelections = selectedOptions.get(group._id) ?? [];
						const hasError =
							showErrors && missingRequiredGroups.some((g: any) => g._id === group._id);

						return (
							<div key={group._id}>
								<div className="flex items-center gap-2 mb-2">
									<span className="text-sm font-semibold text-foreground" >
										{getTranslatedField(group, lang)}
									</span>
									{group.isRequired && (
										<StatusBadge
											bgColor={hasError ? "#fef2f2" : "var(--accent-warning-light)"}
											textColor={hasError ? "#dc2626" : "var(--accent-warning)"}
											label={t(OrderingKeys.ITEM_REQUIRED)}
											className="text-[10px]"
										/>
									)}
									{group.selectionType === "single" && (
										<span className="text-[10px] text-faint-foreground" >
											{t(OrderingKeys.ITEM_PICK_ONE)}
										</span>
									)}
								</div>
								{hasError && (
									<p className="text-xs mb-2" style={{color: "#dc2626"}}>
										{t(OrderingKeys.ITEM_PLEASE_SELECT)}
									</p>
								)}

								<div className="space-y-1.5">
									{(group.options ?? [])
										.filter((o: any) => o.isAvailable)
										.map((opt: any) => {
											const isOptSelected = groupSelections.some((s) => s.optionId === opt._id);
											return (
												<button
													key={opt._id}
													onClick={() => handleOptionToggle(group, opt)}
													className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-foreground"
													style={{backgroundColor: isOptSelected
															? "var(--bg-active)"
															: "var(--bg-secondary)",
				border: `1.5px solid ${optionBorderColor(isOptSelected, hasError)}`}}
												>
													<span
														className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full border-2 transition-colors"
														style={{borderColor: isOptSelected
																? "var(--btn-primary-bg)"
																: "var(--border-default)",
				backgroundColor: isOptSelected
																? "var(--btn-primary-bg)"
																: "transparent"}}
													>
														{isOptSelected && <Check size={12} className="text-white" />}
													</span>
													<span className="flex-1 text-left">{getTranslatedField(opt, lang)}</span>
													{opt.priceModifier > 0 && (
														<span
															className="text-xs shrink-0 text-faint-foreground"
															
														>
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
				</div>

				{/* Bottom action bar */}
				<div
					className="shrink-0 px-4 pb-4 pt-3 space-y-3 border-t border-border"
					
				>
					{/* Quantity picker */}
					<div className="flex items-center justify-center gap-4">
						<button
							onClick={() => setQuantity(Math.max(1, quantity - 1))}
							className="p-2 rounded-full transition-colors bg-muted border border-border text-foreground"
							
						>
							<Minus size={16} />
						</button>
						<span
							className="text-lg font-semibold w-8 text-center text-foreground"
							
						>
							{quantity}
						</span>
						<button
							onClick={() => setQuantity(quantity + 1)}
							className="p-2 rounded-full transition-colors bg-muted border border-border text-foreground"
							
						>
							<Plus size={16} />
						</button>
					</div>

					<button
						onClick={handleSubmit}
						className="w-full py-3 rounded-xl text-sm font-medium hover-btn-primary"
					>
						{isEditing
							? t(OrderingKeys.ITEM_UPDATE_CART)
							: t(OrderingKeys.ITEM_ADD_TO_CART)}{" "}
						&mdash; ${formatCents(lineTotal)}
					</button>

					{isEditing && onRemove && (
						<button
							onClick={onRemove}
							className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm transition-colors"
							style={{color: "#dc2626"}}
						>
							<Trash2 size={14} />
							{t(OrderingKeys.ITEM_REMOVE_FROM_ORDER)}
						</button>
					)}
				</div>
			</div>
		</Modal>
	);
}
