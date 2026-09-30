import { MenusKeys } from "@/global/i18n";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMenuItemDraft, type EditableMenuItem } from "../../hooks/useMenuItemDraft";
import { ItemEditorFields } from "./ItemEditorFields";
import { ItemEditorFooter } from "./ItemEditorFooter";
import { ItemImageWell } from "./ItemImageWell";
import { useItemEditorKeys } from "./useItemEditorKeys";

/**
 * Desktop item editor: docked in the page's right column in place of the
 * category index. The column keeps one fixed width either way, so the rows
 * never reflow when the editor opens.
 *
 * Key it by item id: switching items starts a fresh draft.
 */
export function ItemEditorInspector({
	item,
	categoryName,
	onClose,
}: Readonly<{ item: EditableMenuItem; categoryName: string; onClose: () => void }>) {
	const { t } = useTranslation();
	const draft = useMenuItemDraft(item);
	const { requestClose, saveAndClose } = useItemEditorKeys(draft, onClose, { handleEscape: true });

	return (
		<aside
			aria-label={t(MenusKeys.ITEM_EDITOR_TITLE)}
			className="sticky top-[calc(var(--admin-chrome-height,7rem)+1rem)] flex max-h-[calc(100dvh-var(--admin-chrome-height,7rem)-3rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-lg)]"
		>
			<header className="flex items-center gap-2 border-b border-border py-3 pl-4 pr-2">
				<div className="min-w-0 flex-1">
					<p className="truncate text-[11px] text-faint-foreground">
						{categoryName} · {t(MenusKeys.ITEM_EDITOR_TITLE)}
					</p>
					<h2 className="truncate text-sm font-semibold text-foreground">
						{draft.fields.name || item.name}
					</h2>
				</div>
				<button
					type="button"
					onClick={requestClose}
					aria-label={t(MenusKeys.ITEM_EDITOR_CLOSE)}
					className="flex h-8 w-8 items-center justify-center rounded-md text-faint-foreground hover:bg-hover hover:text-foreground"
				>
					<X size={16} />
				</button>
			</header>
			<div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
				<ItemImageWell draft={draft} itemName={item.name} aspectClassName="aspect-[16/10]" />
				<ItemEditorFields draft={draft} restaurantId={item.restaurantId} />
			</div>
			<footer className="border-t border-border px-4 py-3">
				<ItemEditorFooter
					draft={draft}
					onCancel={requestClose}
					onSave={() => void saveAndClose()}
				/>
			</footer>
		</aside>
	);
}
