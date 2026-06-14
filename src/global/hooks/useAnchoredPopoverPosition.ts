import {
	resolveAnchoredPopoverPosition,
	type AnchoredPopoverPlacement,
	type ResolvedAnchoredPopoverPosition,
} from "@/global/utils/anchoredPopoverPosition";
import { useCallback, useLayoutEffect, useState, type RefObject } from "react";

interface UseAnchoredPopoverPositionOptions {
	readonly open: boolean;
	readonly placement?: AnchoredPopoverPlacement;
	/** Re-run positioning when this value changes (e.g. month grid updates). */
	readonly repositionKey?: unknown;
}

/**
 * Viewport-aware fixed positioning for `popover="manual"` panels.
 * Escapes overflow clipping from ancestor scroll containers.
 */
export function useAnchoredPopoverPosition(
	triggerRef: RefObject<HTMLElement | null>,
	panelRef: RefObject<HTMLElement | null>,
	{ open, placement = "bottom", repositionKey }: UseAnchoredPopoverPositionOptions
): ResolvedAnchoredPopoverPosition | null {
	const [position, setPosition] = useState<ResolvedAnchoredPopoverPosition | null>(null);

	const computePosition = useCallback(() => {
		const trigger = triggerRef.current;
		const panel = panelRef.current;
		if (!trigger || !panel) return;

		const resolved = resolveAnchoredPopoverPosition(
			{
				triggerRect: trigger.getBoundingClientRect(),
				panelRect: panel.getBoundingClientRect(),
				viewportWidth: globalThis.window.innerWidth,
				viewportHeight: globalThis.window.innerHeight,
			},
			placement
		);
		setPosition(resolved);
	}, [triggerRef, panelRef, placement]);

	useLayoutEffect(() => {
		if (!open) {
			setPosition(null);
			return;
		}
		const panel = panelRef.current;
		if (!panel) return;
		try {
			panel.showPopover();
		} catch {
			// Browser refused to open (likely already-handled state); ignore.
		}
		computePosition();
	}, [open, computePosition, panelRef, repositionKey]);

	useLayoutEffect(() => {
		if (!open) return;
		const onScrollOrResize = () => computePosition();
		globalThis.window.addEventListener("scroll", onScrollOrResize, true);
		globalThis.window.addEventListener("resize", onScrollOrResize);
		return () => {
			globalThis.window.removeEventListener("scroll", onScrollOrResize, true);
			globalThis.window.removeEventListener("resize", onScrollOrResize);
		};
	}, [open, computePosition]);

	return position;
}
