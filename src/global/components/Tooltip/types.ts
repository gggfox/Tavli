import type { ReactElement, ReactNode } from "react";

/**
 * Where to anchor the tooltip relative to its trigger.
 * The component will automatically flip to the opposite edge if the
 * preferred placement does not fit in the viewport.
 */
export type TooltipPlacement = "top" | "bottom";

/**
 * Props for the Tooltip component.
 */
export interface TooltipProps {
	/**
	 * The trigger element. Must be a single React element that accepts
	 * a `ref`, `onMouseEnter`/`onMouseLeave`, `onFocus`/`onBlur`, and
	 * `aria-describedby` (e.g. a native `<button>`).
	 */
	children: ReactElement;

	/**
	 * The content rendered inside the tooltip.
	 */
	content: ReactNode;

	/**
	 * Preferred placement. Defaults to `"top"`. The tooltip flips to the
	 * opposite side if there isn't enough viewport space.
	 */
	placement?: TooltipPlacement;

	/**
	 * Delay in milliseconds before the tooltip appears on hover/focus.
	 * Defaults to `100`. Set to `0` for instant display.
	 */
	delay?: number;

	/**
	 * When `true`, the tooltip never opens. Useful for conditionally
	 * disabling the tooltip without unmounting the trigger.
	 */
	disabled?: boolean;
}
