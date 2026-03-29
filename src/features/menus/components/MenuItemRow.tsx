import { formatCents } from "@/global/utils/money";
import type { Doc, Id } from "convex/_generated/dataModel";
import { Eye, EyeOff, ImagePlus, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { ItemEditForm } from "./ItemEditForm";
import { ItemImageManager } from "./ItemImageManager";
import { ItemOptionGroupPicker } from "./ItemOptionGroupPicker";
import { ItemOptionsIcon } from "./ItemOptionsIcon";

type ExpandedPanel = "edit" | "image" | "options" | null;

interface MenuItemRowProps {
	item: Doc<"menuItems"> & { imageUrl?: string | null };
	restaurantId: Id<"restaurants">;
	onUpdate: (args: {
		itemId: Id<"menuItems">;
		name?: string;
		description?: string;
		basePrice?: number;
	}) => Promise<unknown>;
	onRemove: (args: { itemId: Id<"menuItems"> }) => void;
	onToggleAvailability: (args: { itemId: Id<"menuItems"> }) => void;
}

export function MenuItemRow({
	item,
	restaurantId,
	onUpdate,
	onRemove,
	onToggleAvailability,
}: Readonly<MenuItemRowProps>) {
	const [expandedPanel, setExpandedPanel] = useState<ExpandedPanel>(null);

	const togglePanel = (panel: ExpandedPanel) => {
		setExpandedPanel((prev) => (prev === panel ? null : panel));
	};

	return (
		<div className="space-y-0">
			<div
				className="flex items-center justify-between px-3 py-2 rounded-lg"
				style={{
					backgroundColor: "var(--bg-primary)",
					border: "1px solid var(--border-default)",
					borderBottomLeftRadius: expandedPanel ? 0 : undefined,
					borderBottomRightRadius: expandedPanel ? 0 : undefined,
				}}
			>
				<div className="flex items-center gap-2.5">
					{item.imageUrl ? (
						<img
							src={item.imageUrl}
							alt={item.name}
							className="w-10 h-10 rounded object-cover flex-shrink-0"
						/>
					) : (
						<div
							className="w-10 h-10 rounded flex-shrink-0 flex items-center justify-center"
							style={{
								backgroundColor: "var(--bg-secondary)",
								border: "1px dashed var(--border-default)",
							}}
						>
							<ImagePlus size={14} style={{ color: "var(--text-muted)" }} />
						</div>
					)}
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
							${formatCents(item.basePrice)}
						</span>
					</div>
				</div>
				<div className="flex items-center gap-1">
					<button
						onClick={() => togglePanel("edit")}
						className="p-1 rounded hover:bg-[var(--bg-hover)]"
						title="Edit item"
					>
						<Pencil
							size={14}
							style={{
								color: expandedPanel === "edit" ? "var(--btn-primary-bg)" : "var(--text-muted)",
							}}
						/>
					</button>
					<button
						onClick={() => togglePanel("image")}
						className="p-1 rounded hover:bg-[var(--bg-hover)]"
						title="Manage image"
					>
						<ImagePlus
							size={16}
							style={{
								color:
									expandedPanel === "image"
										? "var(--btn-primary-bg)"
										: item.imageUrl
											? "var(--accent-success)"
											: "var(--text-muted)",
							}}
						/>
					</button>
					<button
						onClick={() => togglePanel("options")}
						className="p-1 rounded hover:bg-[var(--bg-hover)]"
						title="Link option groups"
					>
						<ItemOptionsIcon itemId={item._id} isActive={expandedPanel === "options"} />
					</button>
					<button
						onClick={() => onToggleAvailability({ itemId: item._id })}
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
						onClick={() => onRemove({ itemId: item._id })}
						className="p-1 rounded hover:bg-[var(--bg-hover)]"
						title="Remove item"
					>
						<Trash2 size={14} style={{ color: "var(--accent-danger)" }} />
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
				<ItemOptionGroupPicker itemId={item._id} restaurantId={restaurantId} />
			)}
			{expandedPanel === "image" && (
				<ItemImageManager itemId={item._id} currentImageUrl={item.imageUrl ?? null} />
			)}
		</div>
	);
}
