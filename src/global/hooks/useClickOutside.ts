import { useEffect, type RefObject } from "react";

export interface UseClickOutsideOptions {
	readonly enabled?: boolean;
}

/**
 * Calls `handler` on `pointerdown` events whose target is outside every
 * provided ref's element. Designed for non-dialog overlays (tooltips,
 * popovers, menus) that need to dismiss on outside interaction.
 *
 * Modal-style dismissal should use `useBackdropClick` against the dialog's
 * own ref, since `<dialog>` clicks on its `::backdrop` fire on the dialog
 * element with `event.target === dialogElement`.
 */
export function useClickOutside(
	refs: ReadonlyArray<RefObject<HTMLElement | null>>,
	handler: () => void,
	{ enabled = true }: UseClickOutsideOptions = {}
): void {
	useEffect(() => {
		if (!enabled) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (!target) return;
			for (const ref of refs) {
				if (ref.current?.contains(target)) return;
			}
			handler();
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [enabled, handler, refs]);
}
