import { MenusKeys } from "@/global/i18n";
import type { Id } from "convex/_generated/dataModel";
import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { MenuItemDraft } from "../../hooks/useMenuItemDraft";
import { ItemOptionGroupChips } from "./ItemOptionGroupChips";
import { StationPicker } from "./StationPicker";

const DESCRIPTION_MAX = 200;

const INPUT =
	"w-full rounded-lg border border-input-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-input-placeholder focus:border-input-border-focus";

function Field({
	label,
	hint,
	htmlFor,
	children,
}: Readonly<{ label: string; hint?: string; htmlFor: string; children: ReactNode }>) {
	return (
		<div className="min-w-0 space-y-1.5">
			<label
				htmlFor={htmlFor}
				className="flex items-baseline justify-between text-xs font-medium text-muted-foreground"
			>
				{label}
				{hint ? <span className="font-normal text-faint-foreground">{hint}</span> : null}
			</label>
			{children}
		</div>
	);
}

/** Name and price share a row in every editor; the name flexes, the price is fixed. */
export function ItemEditorFields({
	draft,
	restaurantId,
}: Readonly<{ draft: MenuItemDraft; restaurantId: Id<"restaurants"> }>) {
	const { t } = useTranslation();
	const id = useId();
	const { fields, set } = draft;

	return (
		<div className="space-y-4">
			<div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-3">
				<Field label={t(MenusKeys.ITEM_EDITOR_NAME)} htmlFor={`${id}-name`}>
					<input
						id={`${id}-name`}
						autoFocus
						value={fields.name}
						onChange={(e) => set("name", e.target.value)}
						required
						className={INPUT}
					/>
				</Field>
				<Field label={t(MenusKeys.ITEM_EDITOR_PRICE)} htmlFor={`${id}-price`}>
					<div className="flex items-center rounded-lg border border-input-border bg-input focus-within:border-input-border-focus">
						<span aria-hidden className="pl-3 text-sm text-faint-foreground">
							$
						</span>
						<input
							id={`${id}-price`}
							inputMode="decimal"
							value={fields.price}
							onChange={(e) => set("price", e.target.value)}
							className="w-full min-w-0 bg-transparent px-2 py-2 text-right text-sm tabular-nums text-foreground outline-none"
						/>
					</div>
				</Field>
			</div>
			<Field
				label={t(MenusKeys.ITEM_EDITOR_DESCRIPTION)}
				hint={`${fields.description.length}/${DESCRIPTION_MAX}`}
				htmlFor={`${id}-description`}
			>
				<textarea
					id={`${id}-description`}
					rows={3}
					maxLength={DESCRIPTION_MAX}
					value={fields.description}
					onChange={(e) => set("description", e.target.value)}
					placeholder={t(MenusKeys.ITEM_EDITOR_DESCRIPTION_PLACEHOLDER)}
					className={`${INPUT} resize-none leading-relaxed`}
				/>
			</Field>
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div className="space-y-1.5">
					<span className="block text-xs font-medium text-muted-foreground">
						{t(MenusKeys.ITEM_EDITOR_STATION)}
					</span>
					<StationPicker value={fields.prepStation} onChange={(v) => set("prepStation", v)} />
				</div>
				<button
					type="button"
					role="switch"
					aria-checked={fields.isAvailable}
					onClick={() => set("isAvailable", !fields.isAvailable)}
					className="flex h-9 items-center gap-2 text-xs text-muted-foreground"
				>
					<span
						aria-hidden
						className={`relative h-5 w-9 rounded-full transition-colors ${
							fields.isAvailable ? "bg-success" : "bg-tertiary"
						}`}
					>
						<span
							className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
								fields.isAvailable ? "left-[18px]" : "left-0.5"
							}`}
						/>
					</span>
					{fields.isAvailable ? t(MenusKeys.ITEM_EDITOR_VISIBLE) : t(MenusKeys.ITEM_EDITOR_HIDDEN)}
				</button>
			</div>
			<div className="border-t border-border pt-4">
				<ItemOptionGroupChips
					restaurantId={restaurantId}
					value={fields.optionGroupIds}
					onChange={(ids) => set("optionGroupIds", ids)}
				/>
			</div>
			{draft.error ? (
				<p role="alert" className="text-sm text-destructive">
					{draft.error}
				</p>
			) : null}
		</div>
	);
}
