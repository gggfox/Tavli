import { useEffect } from "react";

/**
 * Locks `document.body` scroll while `enabled` is `true`. Native `<dialog>`
 * does NOT lock body scroll on its own (the dialog renders in the top layer
 * but the underlying page is still scrollable), so this hook is required for
 * any modal-style overlay regardless of how it renders.
 *
 * The previous overflow value is captured at lock-start and restored on
 * cleanup so callers can stack and unstack without losing user-set styles.
 */
export function useBodyScrollLock(enabled: boolean): void {
	useEffect(() => {
		if (!enabled) return;
		if (globalThis.window === undefined) return;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = previousOverflow;
		};
	}, [enabled]);
}
