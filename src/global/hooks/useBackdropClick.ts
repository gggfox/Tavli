import { useEffect, type RefObject } from "react";

export interface UseBackdropClickOptions {
	readonly enabled?: boolean;
}

/**
 * Closes a `<dialog>` when the user clicks its backdrop region.
 *
 * For native `<dialog>` elements, clicks on the `::backdrop` pseudo-element
 * fire on the dialog element itself with `event.target === dialogElement`.
 * Children inside the dialog have a different `event.target`, so they do
 * not trigger this handler.
 */
export function useBackdropClick(
	dialogRef: RefObject<HTMLDialogElement | null>,
	handler: () => void,
	{ enabled = true }: UseBackdropClickOptions = {}
): void {
	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog || !enabled) return;
		const onClick = (event: MouseEvent) => {
			if (event.target === dialog) {
				handler();
			}
		};
		dialog.addEventListener("click", onClick);
		return () => dialog.removeEventListener("click", onClick);
	}, [dialogRef, handler, enabled]);
}
