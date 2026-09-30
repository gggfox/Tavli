import { MenusKeys } from "@/global/i18n";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MenuItemDraft } from "../../hooks/useMenuItemDraft";

/** One height for every footer button: 44px touch targets on phones, 36px from md up. */
const BUTTON =
	"inline-flex h-11 items-center justify-center gap-1 rounded-lg px-4 text-sm font-medium disabled:opacity-40 md:h-9";

/**
 * Phone: the primary action full width on top, Cancelar | Guardar as an even
 * pair below. From md up: one row with the unsaved / shortcut hint on the left.
 */
export function ItemEditorFooter({
	draft,
	onCancel,
	onSave,
	onSaveAndNext,
}: Readonly<{
	draft: MenuItemDraft;
	onCancel: () => void;
	onSave: () => void;
	/** Present when there is a next item to step to (the dialog). */
	onSaveAndNext?: () => void;
}>) {
	const { t } = useTranslation();
	const canSave = draft.dirty && draft.valid && !draft.saving;
	return (
		<div className="flex flex-col gap-2 md:flex-row md:items-center">
			<span className="mr-auto hidden text-[11px] text-faint-foreground md:block">
				{draft.dirty ? (
					<span className="flex items-center gap-1.5 text-warning">
						<span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warning" />
						{t(MenusKeys.ITEM_EDITOR_UNSAVED)}
					</span>
				) : (
					t(MenusKeys.ITEM_EDITOR_SHORTCUTS)
				)}
			</span>
			<div className="grid grid-cols-2 gap-2 md:flex">
				<button type="button" onClick={onCancel} className={`${BUTTON} hover-btn-secondary`}>
					{t(MenusKeys.FORM_CANCEL)}
				</button>
				<button
					type="button"
					onClick={onSave}
					disabled={!canSave}
					className={`${BUTTON} ${onSaveAndNext ? "hover-btn-secondary" : "hover-btn-primary"}`}
				>
					{draft.saving ? t(MenusKeys.FORM_SAVING) : t(MenusKeys.FORM_SAVE)}
				</button>
			</div>
			{onSaveAndNext ? (
				<button
					type="button"
					onClick={onSaveAndNext}
					disabled={draft.saving || !draft.valid}
					className={`${BUTTON} order-first w-full hover-btn-primary md:order-none md:w-auto`}
				>
					{t(MenusKeys.ITEM_EDITOR_SAVE_AND_NEXT)}
					<ChevronRight size={16} aria-hidden />
				</button>
			) : null}
		</div>
	);
}
