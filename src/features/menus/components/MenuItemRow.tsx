import { MenusKeys } from "@/global/i18n";
import { useFormatMoney } from "@/global/hooks/useFormatMoney";
import type { Doc, Id } from "convex/_generated/dataModel";
import { PREP_STATION } from "convex/constants";
import { hasListedPrice } from "convex/_shared/menuPricing";
import { AlertTriangle, Eye, EyeOff, Pencil, Trash2 } from "lucide-react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ItemOptionGroupsBadge } from "./ItemOptionGroupsBadge";
import { MenuItemImagePreview } from "./MenuItemImagePreview";
import { STATION_STYLE } from "./itemEditor/StationPicker";

interface MenuItemRowProps {
	item: Doc<"menuItems"> & { imageUrl?: string | null };
	isSelected: boolean;
	isEditing: boolean;
	/** Toggle this row's selection; `shiftKey` extends a range from the last click. */
	onToggleSelect: (e: { shiftKey: boolean }) => void;
	onEdit: () => void;
	onToggleAvailability: (args: { itemId: Id<"menuItems"> }) => void;
	onRemove: (args: { itemId: Id<"menuItems"> }) => void;
}

/** Row controls opt out of row selection with this attribute. */
const ROW_ACTION = { "data-row-action": "" };

function isRowSurface(target: EventTarget) {
	return !(target as HTMLElement).closest("[data-row-action], a, input, textarea, select");
}

/**
 * One menu item in the editor. The row itself is the selection control:
 * a click tints it (no checkbox), Shift+click selects a range, double-click
 * or Enter opens the editor, Space toggles selection from the keyboard.
 */
export function MenuItemRow({
	item,
	isSelected,
	isEditing,
	onToggleSelect,
	onEdit,
	onToggleAvailability,
	onRemove,
}: Readonly<MenuItemRowProps>) {
	const formatMoney = useFormatMoney();
	const { t } = useTranslation();
	const station = STATION_STYLE[item.prepStation ?? PREP_STATION.KITCHEN];
	// No price yet (0, or a malformed value): diners do not see the dish, so
	// say that instead of printing "$0.00" as though it were a real price.
	const priced = hasListedPrice(item.basePrice);

	const surface = isEditing
		? "bg-background ring-2 ring-primary/70"
		: isSelected
			? "bg-primary/[0.14] ring-1 ring-primary/55 shadow-[inset_3px_0_0_var(--color-primary)]"
			: "bg-background ring-1 ring-border hover:bg-hover";

	return (
		<div
			role="checkbox"
			aria-checked={isSelected}
			aria-label={item.name}
			tabIndex={0}
			data-testid="menu-item-row"
			onClick={(e: MouseEvent) => {
				if (isRowSurface(e.target)) onToggleSelect({ shiftKey: e.shiftKey });
			}}
			onDoubleClick={(e: MouseEvent) => {
				if (isRowSurface(e.target)) onEdit();
			}}
			onKeyDown={(e: KeyboardEvent) => {
				if (e.target !== e.currentTarget) return;
				if (e.key === " ") {
					e.preventDefault();
					onToggleSelect({ shiftKey: e.shiftKey });
				} else if (e.key === "Enter") {
					e.preventDefault();
					onEdit();
				}
			}}
			className={`flex cursor-pointer select-none items-center gap-3 rounded-lg px-2.5 py-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary ${surface}`}
		>
			<MenuItemImagePreview
				imageUrl={item.imageUrl}
				itemName={item.name}
				imageSource={item.imageSource}
			/>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
					<span
						className={`text-sm font-medium ${
							item.isAvailable ? "text-foreground" : "text-faint-foreground line-through"
						}`}
					>
						{item.name}
					</span>
					{priced ? (
						<span className="text-sm tabular-nums text-muted-foreground">
							{formatMoney(item.basePrice)}
						</span>
					) : (
						<span className="inline-flex items-center gap-1 rounded-full bg-warning-subtle px-1.5 py-px text-[11px] font-medium text-warning">
							<AlertTriangle size={11} aria-hidden="true" />
							{t(MenusKeys.ITEM_NO_PRICE_BADGE)}
						</span>
					)}
					<span className={`rounded-full px-1.5 py-px text-[11px] ${station.chip}`}>
						{t(station.labelKey)}
					</span>
					<ItemOptionGroupsBadge itemId={item._id} />
					{item.isAvailable ? null : (
						<span className="rounded-full bg-warning-subtle px-1.5 py-px text-[11px] text-warning">
							{item.unavailableReason ?? t(MenusKeys.ITEM_HIDDEN_BADGE)}
						</span>
					)}
				</div>
				{item.description ? (
					<p className="mt-0.5 truncate text-xs text-faint-foreground">{item.description}</p>
				) : null}
			</div>
			<div className="flex shrink-0 items-center gap-0.5">
				<RowButton
					label={t(MenusKeys.ITEM_EDIT_TITLE)}
					onClick={onEdit}
					className={isEditing ? "text-primary" : undefined}
				>
					<Pencil size={15} />
				</RowButton>
				<RowButton
					label={
						item.isAvailable ? t(MenusKeys.ITEM_MARK_UNAVAILABLE) : t(MenusKeys.ITEM_MARK_AVAILABLE)
					}
					onClick={() => onToggleAvailability({ itemId: item._id })}
				>
					{item.isAvailable ? <Eye size={16} className="text-success" /> : <EyeOff size={16} />}
				</RowButton>
				<RowButton
					label={t(MenusKeys.ITEM_REMOVE_TITLE)}
					onClick={() => onRemove({ itemId: item._id })}
					className="hover:text-destructive"
				>
					<Trash2 size={15} />
				</RowButton>
			</div>
		</div>
	);
}

function RowButton({
	label,
	onClick,
	className,
	children,
}: Readonly<{ label: string; onClick: () => void; className?: string; children: ReactNode }>) {
	return (
		<button
			type="button"
			{...ROW_ACTION}
			title={label}
			aria-label={label}
			onClick={onClick}
			className={`flex h-9 w-9 items-center justify-center rounded-md text-faint-foreground hover:bg-hover hover:text-foreground md:h-8 md:w-8 ${className ?? ""}`}
		>
			{children}
		</button>
	);
}
