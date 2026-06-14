export const ANCHORED_POPOVER_VIEWPORT_GUTTER = 8;
export const ANCHORED_POPOVER_TRIGGER_OFFSET = 8;

export type AnchoredPopoverPlacement = "top" | "bottom";

export interface AnchoredPopoverRects {
	readonly triggerRect: DOMRectReadOnly | DOMRect;
	readonly panelRect: DOMRectReadOnly | DOMRect;
	readonly viewportWidth: number;
	readonly viewportHeight: number;
}

export interface ResolvedAnchoredPopoverPosition {
	readonly top: number;
	readonly left: number;
	readonly placement: AnchoredPopoverPlacement;
}

/** Clamp panel left edge so it stays within the viewport with gutter padding. */
export function clampAnchoredPopoverLeft(
	triggerCenterX: number,
	panelWidth: number,
	viewportWidth: number,
	gutter = ANCHORED_POPOVER_VIEWPORT_GUTTER
): number {
	const minLeft = gutter;
	const maxLeft = Math.max(gutter, viewportWidth - panelWidth - gutter);
	let left = triggerCenterX - panelWidth / 2;
	if (left < minLeft) left = minLeft;
	if (left > maxLeft) left = maxLeft;
	return left;
}

/** Resolve fixed top/left for a popover anchored to a trigger, flipping vertically when needed. */
export function resolveAnchoredPopoverPosition(
	{ triggerRect, panelRect, viewportWidth, viewportHeight }: AnchoredPopoverRects,
	preferredPlacement: AnchoredPopoverPlacement = "bottom",
	triggerOffset = ANCHORED_POPOVER_TRIGGER_OFFSET,
	gutter = ANCHORED_POPOVER_VIEWPORT_GUTTER
): ResolvedAnchoredPopoverPosition {
	const fitsBelow = triggerRect.bottom + panelRect.height + triggerOffset <= viewportHeight;
	const fitsAbove = triggerRect.top - panelRect.height - triggerOffset >= 0;

	let placement = preferredPlacement;
	if (preferredPlacement === "bottom" && !fitsBelow && fitsAbove) {
		placement = "top";
	} else if (preferredPlacement === "top" && !fitsAbove && fitsBelow) {
		placement = "bottom";
	}

	const top =
		placement === "top"
			? triggerRect.top - panelRect.height - triggerOffset
			: triggerRect.bottom + triggerOffset;

	const triggerCenter = triggerRect.left + triggerRect.width / 2;
	const left = clampAnchoredPopoverLeft(triggerCenter, panelRect.width, viewportWidth, gutter);

	return { top, left, placement };
}
