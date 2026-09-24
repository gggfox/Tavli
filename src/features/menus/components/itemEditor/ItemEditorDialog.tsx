import { Modal } from "@/global/components";
import { MenusKeys } from "@/global/i18n";
import type { Id } from "convex/_generated/dataModel";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMenuItemDraft, type EditableMenuItem } from "../../hooks/useMenuItemDraft";
import { ItemEditorFields } from "./ItemEditorFields";
import { ItemEditorFooter } from "./ItemEditorFooter";
import { ItemImageWell } from "./ItemImageWell";
import { useItemEditorKeys } from "./useItemEditorKeys";

/** The three header controls share one square size: 40px on phones, 32px from md up. */
const HEADER_ICON =
	"flex h-10 w-10 items-center justify-center rounded-md text-faint-foreground hover:bg-hover hover:text-foreground disabled:opacity-30 md:h-8 md:w-8";

/**
 * Tablet and phone item editor: a centred dialog from md up, a full-screen
 * sheet on phones. Previous / next and "Guardar y siguiente" step through the
 * visible items of the same category.
 *
 * Key it by item id: stepping to another item starts a fresh draft.
 */
export function ItemEditorDialog({
	item,
	categoryName,
	siblingIds,
	onGo,
	onClose,
}: Readonly<{
	item: EditableMenuItem;
	categoryName: string;
	/** Visible items of the category, in display order. */
	siblingIds: readonly Id<"menuItems">[];
	onGo: (itemId: Id<"menuItems">) => void;
	onClose: () => void;
}>) {
	const { t } = useTranslation();
	const draft = useMenuItemDraft(item);
	const { requestClose, saveAndClose } = useItemEditorKeys(draft, onClose, {
		handleEscape: false,
	});

	const index = siblingIds.indexOf(item._id);
	const prevId = index > 0 ? siblingIds[index - 1] : undefined;
	const nextId = index !== -1 ? siblingIds[index + 1] : undefined;
	const position =
		index === -1
			? null
			: t(MenusKeys.ITEM_EDITOR_POSITION, { index: index + 1, total: siblingIds.length });

	const go = (id: Id<"menuItems"> | undefined) => {
		if (!id) return;
		if (draft.dirty && !globalThis.confirm(t(MenusKeys.ITEM_EDITOR_DISCARD_CONFIRM))) return;
		onGo(id);
	};
	const saveAndNext = async () => {
		if (!nextId) return;
		if (draft.dirty && !(await draft.save())) return;
		onGo(nextId);
	};

	return (
		<Modal
			isOpen
			onClose={requestClose}
			size="3xl"
			ariaLabel={`${t(MenusKeys.ITEM_EDITOR_TITLE)}: ${item.name}`}
			containerClassName="max-md:!m-0 max-md:!h-dvh max-md:!max-h-dvh max-md:!max-w-full"
			contentClassName="flex h-full flex-col !overflow-hidden bg-card max-md:!max-h-dvh md:rounded-2xl md:border md:border-border md:!max-h-[92dvh] md:shadow-[var(--shadow-lg)]"
		>
			<header className="flex items-center gap-1 border-b border-border py-2 pl-4 pr-2 md:py-3 md:pl-5 md:pr-3">
				<div className="min-w-0 flex-1">
					<p className="truncate text-[11px] text-faint-foreground md:hidden">
						{categoryName}
						{position ? ` · ${position}` : null}
					</p>
					<p className="truncate text-sm">
						<span className="hidden text-faint-foreground md:inline">{categoryName} · </span>
						<span className="font-semibold text-foreground">{draft.fields.name || item.name}</span>
					</p>
				</div>
				{position ? (
					<span className="mr-1 hidden text-xs tabular-nums text-faint-foreground md:inline">
						{position}
					</span>
				) : null}
				<button
					type="button"
					onClick={() => go(prevId)}
					disabled={!prevId}
					aria-label={t(MenusKeys.ITEM_EDITOR_PREVIOUS)}
					className={HEADER_ICON}
				>
					<ChevronLeft size={20} />
				</button>
				<button
					type="button"
					onClick={() => go(nextId)}
					disabled={!nextId}
					aria-label={t(MenusKeys.ITEM_EDITOR_NEXT)}
					className={HEADER_ICON}
				>
					<ChevronRight size={20} />
				</button>
				<span aria-hidden className="mx-1 h-5 w-px bg-border" />
				<button
					type="button"
					onClick={requestClose}
					aria-label={t(MenusKeys.ITEM_EDITOR_CLOSE)}
					className={HEADER_ICON}
				>
					<X size={20} />
				</button>
			</header>
			<div className="grid min-h-0 flex-1 content-start gap-6 overflow-y-auto p-4 md:grid-cols-[16rem_minmax(0,1fr)] md:p-5">
				<ItemImageWell
					draft={draft}
					itemName={item.name}
					aspectClassName="aspect-[16/10] md:aspect-square"
				/>
				<ItemEditorFields draft={draft} restaurantId={item.restaurantId} />
			</div>
			<footer className="border-t border-border px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:px-5">
				<ItemEditorFooter
					draft={draft}
					onCancel={requestClose}
					onSave={() => void saveAndClose()}
					onSaveAndNext={nextId ? () => void saveAndNext() : undefined}
				/>
			</footer>
		</Modal>
	);
}
