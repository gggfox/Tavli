import { useClickOutside, useEscapeKey } from "@/global/hooks";
import type { Id } from "convex/_generated/dataModel";
import { ChevronDown } from "lucide-react";
import { useCallback, useId, useMemo, useRef, useState } from "react";

export type RestaurantInviteOption = {
	readonly id: Id<"restaurants">;
	readonly label: string;
};

export type RestaurantInviteMultiSelectProps = {
	readonly options: readonly RestaurantInviteOption[];
	readonly selectedIds: readonly Id<"restaurants">[];
	readonly onChange: (ids: Id<"restaurants">[]) => void;
	readonly placeholder: string;
	/** Shown on the trigger when at least one restaurant is selected (i18n built in parent). */
	readonly summaryText: string;
	readonly disabled?: boolean;
	readonly ariaLabel: string;
};

export function RestaurantInviteMultiSelect({
	options,
	selectedIds,
	onChange,
	placeholder,
	summaryText,
	disabled,
	ariaLabel,
}: RestaurantInviteMultiSelectProps) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const listId = useId();

	const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

	const close = useCallback(() => setOpen(false), []);
	useClickOutside([triggerRef, panelRef], close, { enabled: open });
	useEscapeKey(close, { enabled: open });

	const toggle = (id: Id<"restaurants">) => {
		const next = selectedSet.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
		onChange(next);
	};

	const hasSelection = selectedIds.length > 0;
	const triggerLabel = hasSelection ? summaryText : placeholder;

	return (
		<div className="relative">
			<button
				ref={triggerRef}
				type="button"
				disabled={disabled || options.length === 0}
				aria-expanded={open}
				aria-haspopup="listbox"
				aria-controls={listId}
				aria-label={ariaLabel}
				onClick={() => setOpen((o) => !o)}
				className="mt-1 flex w-full items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
			>
				<span className={hasSelection ? "truncate" : "truncate text-faint-foreground"}>{triggerLabel}</span>
				<ChevronDown className={`size-4 shrink-0 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
			</button>
			{open && options.length > 0 ? (
				<div
					ref={panelRef}
					id={listId}
					role="listbox"
					aria-multiselectable
					className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-card py-1 shadow-md"
				>
					{options.map((opt) => {
						const checked = selectedSet.has(opt.id);
						return (
							<button
								key={opt.id}
								type="button"
								role="option"
								aria-selected={checked}
								onClick={() => toggle(opt.id)}
								className="flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted/60"
							>
								<span
									className="flex size-4 shrink-0 items-center justify-center rounded border border-border bg-background"
									aria-hidden
								>
									{checked ? <span className="text-primary text-xs font-bold">✓</span> : null}
								</span>
								<span className="truncate">{opt.label}</span>
							</button>
						);
					})}
				</div>
			) : null}
		</div>
	);
}
