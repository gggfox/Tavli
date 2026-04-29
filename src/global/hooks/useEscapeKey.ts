import { useEffect } from "react";
import { KEY } from "@/global/utils/keyboard";

export interface UseEscapeKeyOptions {
	readonly enabled?: boolean;
}

/**
 * Document-level Escape key handler. Modal/Drawer get Escape via
 * `<dialog>`'s native `cancel` event; this hook is intended for non-dialog
 * overlays such as Tooltip and floating menus.
 */
export function useEscapeKey(
	handler: () => void,
	{ enabled = true }: UseEscapeKeyOptions = {}
): void {
	useEffect(() => {
		if (!enabled) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === KEY.Escape) handler();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [enabled, handler]);
}
