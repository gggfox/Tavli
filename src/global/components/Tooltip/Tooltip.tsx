import {
	cloneElement,
	isValidElement,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	type FocusEvent,
	type MouseEvent,
	type Ref,
	type TouchEvent,
} from "react";
import { useClickOutside, useEscapeKey, useLongPress, useMediaQuery } from "@/global/hooks";
import type { TooltipPlacement, TooltipProps } from "./types";

const VIEWPORT_GUTTER = 8;
const TRIGGER_OFFSET = 8;

interface ResolvedPosition {
	top: number;
	left: number;
	placement: TooltipPlacement;
}

type TriggerProps = {
	ref?: Ref<HTMLElement>;
	title?: string;
	"aria-describedby"?: string;
	onMouseEnter?: (event: MouseEvent<HTMLElement>) => void;
	onMouseLeave?: (event: MouseEvent<HTMLElement>) => void;
	onFocus?: (event: FocusEvent<HTMLElement>) => void;
	onBlur?: (event: FocusEvent<HTMLElement>) => void;
	onTouchStart?: (event: TouchEvent<HTMLElement>) => void;
	onTouchEnd?: (event: TouchEvent<HTMLElement>) => void;
	onTouchMove?: (event: TouchEvent<HTMLElement>) => void;
	onTouchCancel?: (event: TouchEvent<HTMLElement>) => void;
	onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
};

/**
 * Lightweight tooltip built on the HTML `popover="manual"` API.
 *
 * `popover="manual"` provides:
 *   - Top-layer rendering (no portal, no z-index wrangling).
 *   - Automatic show/hide via `showPopover()` / `hidePopover()`.
 *
 * Browser support: Chrome 114+, Safari 17+, Firefox 125+. On older
 * browsers the tooltip falls back to the native `title` attribute on the
 * trigger element.
 *
 * Positioning is calculated manually (preferred placement; flips on
 * viewport overflow). The hook owns hover/focus → show, mouseleave/blur →
 * hide, Escape → hide, pointerdown-outside → hide.
 */
export function Tooltip({
	children,
	content,
	placement = "top",
	delay = 100,
	longPressDelay,
	contentPadding = "default",
	disabled = false,
}: Readonly<TooltipProps>) {
	const [supportsPopover] = useState(
		() => typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype
	);
	const [isOpen, setIsOpen] = useState(false);
	const [position, setPosition] = useState<ResolvedPosition | null>(null);
	const hasHover = useMediaQuery("(hover: hover)", () => true);
	const touchLongPressDelay = longPressDelay ?? 500;
	const useLongPressTrigger = longPressDelay !== undefined && !hasHover;

	const triggerRef = useRef<HTMLElement | null>(null);
	const tooltipRef = useRef<HTMLDivElement | null>(null);
	const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const tooltipId = useId();

	const clearShowTimer = useCallback(() => {
		if (showTimerRef.current !== null) {
			clearTimeout(showTimerRef.current);
			showTimerRef.current = null;
		}
	}, []);

	const show = useCallback(() => {
		if (disabled || !supportsPopover) return;
		clearShowTimer();
		if (delay <= 0) {
			setIsOpen(true);
			return;
		}
		showTimerRef.current = setTimeout(() => setIsOpen(true), delay);
	}, [disabled, delay, clearShowTimer, supportsPopover]);

	const showImmediate = useCallback(() => {
		if (disabled || !supportsPopover) return;
		clearShowTimer();
		setIsOpen(true);
	}, [disabled, clearShowTimer, supportsPopover]);

	const hide = useCallback(() => {
		clearShowTimer();
		setIsOpen(false);
	}, [clearShowTimer]);

	const longPressHandlers = useLongPress({
		onLongPress: showImmediate,
		onCancel: hide,
		delay: touchLongPressDelay,
		disabled: disabled || !useLongPressTrigger || !supportsPopover,
	});

	const computePosition = useCallback(() => {
		const trigger = triggerRef.current;
		const tooltip = tooltipRef.current;
		if (!trigger || !tooltip) return;

		const triggerRect = trigger.getBoundingClientRect();
		const tooltipRect = tooltip.getBoundingClientRect();
		const viewportHeight = globalThis.window.innerHeight;
		const viewportWidth = globalThis.window.innerWidth;

		let resolved: TooltipPlacement = placement;

		if (resolved === "top" && triggerRect.top - tooltipRect.height - TRIGGER_OFFSET < 0) {
			resolved = "bottom";
		} else if (
			resolved === "bottom" &&
			triggerRect.bottom + tooltipRect.height + TRIGGER_OFFSET > viewportHeight
		) {
			resolved = "top";
		} else if (
			resolved === "right" &&
			triggerRect.right + tooltipRect.width + TRIGGER_OFFSET > viewportWidth
		) {
			resolved = "left";
		} else if (resolved === "left" && triggerRect.left - tooltipRect.width - TRIGGER_OFFSET < 0) {
			resolved = "right";
		}

		let top: number;
		let left: number;

		if (resolved === "left" || resolved === "right") {
			const triggerCenterY = triggerRect.top + triggerRect.height / 2;
			const minTop = VIEWPORT_GUTTER;
			const maxTop = viewportHeight - tooltipRect.height - VIEWPORT_GUTTER;
			top = triggerCenterY - tooltipRect.height / 2;
			if (top < minTop) top = minTop;
			if (top > maxTop) top = maxTop;

			left =
				resolved === "right"
					? triggerRect.right + TRIGGER_OFFSET
					: triggerRect.left - tooltipRect.width - TRIGGER_OFFSET;
		} else {
			top =
				resolved === "top"
					? triggerRect.top - tooltipRect.height - TRIGGER_OFFSET
					: triggerRect.bottom + TRIGGER_OFFSET;

			const triggerCenter = triggerRect.left + triggerRect.width / 2;
			const minLeft = VIEWPORT_GUTTER;
			const maxLeft = viewportWidth - tooltipRect.width - VIEWPORT_GUTTER;
			left = triggerCenter - tooltipRect.width / 2;
			if (left < minLeft) left = minLeft;
			if (left > maxLeft) left = maxLeft;
		}

		setPosition({ top, left, placement: resolved });
	}, [placement]);

	useLayoutEffect(() => {
		if (!isOpen) {
			setPosition(null);
			return;
		}
		const tooltip = tooltipRef.current;
		if (!tooltip) return;
		try {
			tooltip.showPopover();
		} catch {
			// Browser refused to open (likely already-handled state); ignore.
		}
		computePosition();
	}, [isOpen, computePosition]);

	useEffect(() => {
		if (!isOpen) return;
		const onScrollOrResize = () => computePosition();
		globalThis.window.addEventListener("scroll", onScrollOrResize, true);
		globalThis.window.addEventListener("resize", onScrollOrResize);
		return () => {
			globalThis.window.removeEventListener("scroll", onScrollOrResize, true);
			globalThis.window.removeEventListener("resize", onScrollOrResize);
		};
	}, [isOpen, computePosition]);

	useEscapeKey(hide, { enabled: isOpen });
	useClickOutside([triggerRef, tooltipRef], hide, { enabled: isOpen });

	useEffect(() => () => clearShowTimer(), [clearShowTimer]);

	if (!isValidElement<TriggerProps>(children)) {
		return children;
	}

	const childProps = children.props;

	// Fallback: browsers without popover support get the native title attribute.
	if (!supportsPopover) {
		const titleFallback = typeof content === "string" ? content : undefined;
		return cloneElement<TriggerProps>(children, {
			title: titleFallback ?? childProps.title,
		});
	}

	const existingDescribedBy = childProps["aria-describedby"];
	const mergedDescribedBy = isOpen
		? [existingDescribedBy, tooltipId].filter(Boolean).join(" ") || undefined
		: existingDescribedBy;

	const setTriggerRef = (node: HTMLElement | null) => {
		triggerRef.current = node;
		const existingRef = childProps.ref;
		if (typeof existingRef === "function") {
			existingRef(node);
		} else if (existingRef && typeof existingRef === "object") {
			(existingRef as { current: HTMLElement | null }).current = node;
		}
	};

	const wrappedChild = cloneElement<TriggerProps>(children, {
		ref: setTriggerRef,
		"aria-describedby": mergedDescribedBy,
		onMouseEnter: (event: MouseEvent<HTMLElement>) => {
			childProps.onMouseEnter?.(event);
			if (!useLongPressTrigger) {
				show();
			}
		},
		onMouseLeave: (event: MouseEvent<HTMLElement>) => {
			childProps.onMouseLeave?.(event);
			if (!useLongPressTrigger) {
				hide();
			}
		},
		onFocus: (event: FocusEvent<HTMLElement>) => {
			childProps.onFocus?.(event);
			if (!useLongPressTrigger) {
				show();
			}
		},
		onBlur: (event: FocusEvent<HTMLElement>) => {
			childProps.onBlur?.(event);
			if (!useLongPressTrigger) {
				hide();
			}
		},
		onTouchStart: (event: TouchEvent<HTMLElement>) => {
			childProps.onTouchStart?.(event);
			longPressHandlers.onTouchStart(event);
		},
		onTouchEnd: (event: TouchEvent<HTMLElement>) => {
			childProps.onTouchEnd?.(event);
			longPressHandlers.onTouchEnd();
		},
		onTouchMove: (event: TouchEvent<HTMLElement>) => {
			childProps.onTouchMove?.(event);
			longPressHandlers.onTouchMove(event);
		},
		onTouchCancel: (event: TouchEvent<HTMLElement>) => {
			childProps.onTouchCancel?.(event);
			longPressHandlers.onTouchCancel();
		},
		onContextMenu: (event: MouseEvent<HTMLElement>) => {
			childProps.onContextMenu?.(event);
			longPressHandlers.onContextMenu(event);
		},
	});

	return (
		<>
			{wrappedChild}
			{isOpen && (
				<div
					ref={tooltipRef}
					popover="manual"
					role="tooltip"
					id={tooltipId}
					className="bg-muted text-foreground border border-border"
					style={{
						position: "fixed",
						top: position?.top ?? -9999,
						left: position?.left ?? -9999,
						margin: 0,
						maxWidth: 320,
						borderRadius: 8,
						boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25)",
						padding: contentPadding === "none" ? 0 : "8px 10px",
						fontSize: 12,
						lineHeight: 1.4,
						overflow: "hidden",
						visibility: position === null ? "hidden" : "visible",
					}}
				>
					{content}
				</div>
			)}
		</>
	);
}
