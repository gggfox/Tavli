import { useEffect, type RefObject } from "react";

export interface UseDialogCancelOptions {
	readonly enabled?: boolean;
}

/**
 * Listens for the native `<dialog>` `cancel` event (fired when the user
 * presses Escape). The default browser behavior is an immediate `close()`,
 * which would skip any `closing` animation; we `preventDefault` and let
 * the caller drive the close through their phase machine instead.
 */
export function useDialogCancel(
	dialogRef: RefObject<HTMLDialogElement | null>,
	handler: () => void,
	{ enabled = true }: UseDialogCancelOptions = {}
): void {
	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog || !enabled) return;
		const onCancel = (event: Event) => {
			event.preventDefault();
			handler();
		};
		dialog.addEventListener("cancel", onCancel);
		return () => dialog.removeEventListener("cancel", onCancel);
	}, [dialogRef, handler, enabled]);
}
