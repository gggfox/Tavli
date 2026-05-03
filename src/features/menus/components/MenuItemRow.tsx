import { MenusKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import type { Doc, Id } from "convex/_generated/dataModel";
import { Eye, EyeOff, ImagePlus, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ItemEditForm } from "./ItemEditForm";
import { ItemImageManager } from "./ItemImageManager";
import { ItemOptionGroupPicker } from "./ItemOptionGroupPicker";
import { ItemOptionsIcon } from "./ItemOptionsIcon";

type ExpandedPanel = "edit" | "image" | "options" | null;

interface MenuItemRowProps {
	item: Doc<"menuItems"> & { imageUrl?: string | null };
	onUpdate: (args: {
		itemId: Id<"menuItems">;
		name?: string;
		description?: string;
		basePrice?: number;
	}) => Promise<unknown>;
	onRemove: (args: { itemId: Id<"menuItems"> }) => void;
	onToggleAvailability: (args: { itemId: Id<"menuItems"> }) => void;
	/** When set, shows a bulk-selection checkbox before the item row. */
	bulkSelect?: { isSelected: boolean; onToggle: () => void };
}

export function MenuItemRow({
	item,
	onUpdate,
	onRemove,
	onToggleAvailability,
	bulkSelect,
}: Readonly<MenuItemRowProps>) {
	const { t } = useTranslation();
	const [expandedPanel, setExpandedPanel] = useState<ExpandedPanel>(null);

	const togglePanel = (panel: ExpandedPanel) => {
		setExpandedPanel((prev) => (prev === panel ? null : panel));
	};

	return (
		<div className="space-y-0">
			<div
				className="flex items-center justify-between px-3 py-2 rounded-lg bg-background border border-border"
				style={{borderBottomLeftRadius: expandedPanel ? 0 : undefined,
				borderBottomRightRadius: expandedPanel ? 0 : undefined}}
			>
				<div className="flex items-center gap-2.5">
					{bulkSelect ? (
						<input
							type="checkbox"
							checked={bulkSelect.isSelected}
							onChange={(e) => {
								e.stopPropagation();
								bulkSelect.onToggle();
							}}
							className="h-4 w-4 rounded border-border accent-[var(--btn-primary-bg)] shrink-0"
							aria-label={item.name}
						/>
					) : null}
					{item.imageUrl ? (
						<img
							src={item.imageUrl}
							alt={item.name}
							className="w-10 h-10 rounded object-cover flex-shrink-0"
						/>
					) : (
						<div
							className="w-10 h-10 rounded flex-shrink-0 flex items-center justify-center bg-muted border border-border"
							
						>
							<ImagePlus size={14} className="text-faint-foreground"  />
						</div>
					)}
					<div>
						<span
							className="text-sm font-medium"
							style={{color: item.isAvailable ? "var(--text-primary)" : "var(--text-muted)"}}
						>
							{item.name}
						</span>
						{!item.isAvailable && item.unavailableReason && (
							<span className="text-xs ml-2 text-warning" >
								({item.unavailableReason})
							</span>
						)}
						<span className="text-sm ml-3 text-muted-foreground" >
							${formatCents(item.basePrice)}
						</span>
					</div>
				</div>
				<div className="flex items-center gap-1">
					<button
						onClick={() => togglePanel("edit")}
						className="p-1 rounded hover:bg-hover"
						title={t(MenusKeys.ITEM_EDIT_TITLE)}
					>
						<Pencil
							size={14}
							style={{color: expandedPanel === "edit" ? "var(--btn-primary-bg)" : "var(--text-muted)"}}
						/>
					</button>
					<button
						onClick={() => togglePanel("image")}
						className="p-1 rounded hover:bg-hover"
						title={t(MenusKeys.ITEM_IMAGE_TITLE)}
					>
						<ImagePlus
							size={16}
							style={{color:
									expandedPanel === "image"
										? "var(--btn-primary-bg)"
										: item.imageUrl
											? "var(--accent-success)"
											: "var(--text-muted)"}}
						/>
					</button>
					<button
						onClick={() => togglePanel("options")}
						className="p-1 rounded hover:bg-hover"
						title={t(MenusKeys.ITEM_OPTIONS_TITLE)}
					>
						<ItemOptionsIcon itemId={item._id} isActive={expandedPanel === "options"} />
					</button>
					<button
						onClick={() => onToggleAvailability({ itemId: item._id })}
						className="p-1 rounded hover:bg-hover text-success"
						title={
							item.isAvailable
								? t(MenusKeys.ITEM_MARK_UNAVAILABLE)
								: t(MenusKeys.ITEM_MARK_AVAILABLE)
						}
					>
						{item.isAvailable ? (
							<Eye size={16}  />
						) : (
							<EyeOff size={16} className="text-faint-foreground"  />
						)}
					</button>
					<button
						onClick={() => onRemove({ itemId: item._id })}
						className="p-1 rounded hover:bg-hover text-destructive"
						title={t(MenusKeys.ITEM_REMOVE_TITLE)}
					>
						<Trash2 size={14}  />
					</button>
				</div>
			</div>
			{expandedPanel === "edit" && (
				<ItemEditForm
					itemId={item._id}
					currentName={item.name}
					currentDescription={item.description ?? ""}
					currentPrice={item.basePrice}
					onSave={onUpdate}
					onClose={() => setExpandedPanel(null)}
				/>
			)}
			{expandedPanel === "options" && (
				<ItemOptionGroupPicker itemId={item._id} restaurantId={item.restaurantId} />
			)}
			{expandedPanel === "image" && (
				<ItemImageManager
					itemId={item._id}
					restaurantId={item.restaurantId}
					currentImageUrl={item.imageUrl ?? null}
				/>
			)}
		</div>
	);
}
