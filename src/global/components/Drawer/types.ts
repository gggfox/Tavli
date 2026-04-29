import type { ReactNode } from "react";

/**
 * Edge from which the drawer slides in.
 */
export type DrawerSide = "left" | "right" | "top" | "bottom";

/**
 * Props for the Drawer component.
 */
export interface DrawerProps {
	/**
	 * Whether the drawer is open. Toggling this drives the open and close
	 * animations; the drawer stays mounted until the close animation
	 * finishes.
	 */
	isOpen: boolean;

	/**
	 * Called when the drawer requests to close (Escape key, backdrop click,
	 * or programmatic dismissal).
	 */
	onClose: () => void;

	/**
	 * Drawer body content.
	 */
	children: ReactNode;

	/**
	 * Edge to slide in from.
	 * @default "right"
	 */
	side?: DrawerSide;

	/**
	 * Duration of the panel slide animation in milliseconds. The overlay
	 * fade is automatically scaled to ~50ms shorter to match Mantine's
	 * cadence.
	 * @default 250
	 */
	durationMs?: number;

	/**
	 * CSS timing function used for both the open and close animations.
	 * @default "ease"
	 */
	easing?: string;

	/**
	 * Optional explicit panel size. For `left` and `right` drawers this
	 * controls the width; for `top` and `bottom` drawers it controls the
	 * height. Accepts any valid CSS length (e.g. `"420px"`, `"32rem"`).
	 * Defaults to `"min(440px, 90vw)"` for left/right and `"min(60vh, 480px)"`
	 * for top/bottom.
	 */
	size?: string;

	/**
	 * ARIA label for assistive tech. Required when there is no visible
	 * heading inside the drawer; otherwise `ariaLabelledBy` can be used
	 * via the rendered children's `id`.
	 */
	ariaLabel?: string;

	/**
	 * Whether clicking the backdrop closes the drawer.
	 * @default true
	 */
	closeOnBackdropClick?: boolean;

	/**
	 * Whether pressing Escape closes the drawer.
	 * @default true
	 */
	closeOnEscape?: boolean;

	/**
	 * Optional class name applied to the panel element.
	 */
	panelClassName?: string;

	/**
	 * Optional class name applied to the backdrop element.
	 */
	backdropClassName?: string;
}
