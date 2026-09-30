import { MenusKeys } from "@/global/i18n";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { MenuItemDraft } from "../../hooks/useMenuItemDraft";

/**
 * Close and save for both editor shells. Closing with unsaved changes asks
 * first; ⌘/Ctrl+Enter saves and closes. Escape is handled here only when
 * `handleEscape` is set — the dialog gets it from the native <dialog>.
 */
export function useItemEditorKeys(
	draft: MenuItemDraft,
	onClose: () => void,
	{ handleEscape }: { handleEscape: boolean }
) {
	const { t } = useTranslation();

	const requestClose = () => {
		if (draft.dirty && !globalThis.confirm(t(MenusKeys.ITEM_EDITOR_DISCARD_CONFIRM))) return;
		draft.reset();
		onClose();
	};
	const saveAndClose = async () => {
		if (!draft.dirty) return onClose();
		if (await draft.save()) onClose();
	};

	const latest = useRef({ requestClose, saveAndClose, draft });
	latest.current = { requestClose, saveAndClose, draft };

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				void latest.current.saveAndClose();
			} else if (handleEscape && e.key === "Escape") {
				e.preventDefault();
				latest.current.requestClose();
			}
		};
		globalThis.addEventListener("keydown", onKey);
		return () => globalThis.removeEventListener("keydown", onKey);
	}, [handleEscape]);

	return { requestClose, saveAndClose };
}
