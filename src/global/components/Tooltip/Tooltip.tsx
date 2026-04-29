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
} from "react";
import { useClickOutside, useEscapeKey } from "@/global/hooks";
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
	disabled = false,
}: Readonly<TooltipProps>) {
	const [supportsPopover, setSupportsPopover] = useState(false);
	const [isOpen, setIsOpen] = useState(false);
	const [position, setPosition] = useState<ResolvedPosition | null>(null);

	const triggerRef = useRef<HTMLElement | null>(null);
	const tooltipRef = useRef<HTMLDivElement | null>(null);
	const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const tooltipId = useId();

	useEffect(() => {
		setSupportsPopover(
			typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype
		);
	}, []);

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

	const hide = useCallback(() => {
		clearShowTimer();
		setIsOpen(false);
	}, [clearShowTimer]);

	const computePosition = useCallback(() => {
		const trigger = triggerRef.current;
		const tooltip = tooltipRef.current;
		if (!trigger || !tooltip) return;

		const triggerRect = trigger.getBoundingClientRect();
		const tooltipRect = tooltip.getBoundingClientRect();
		const viewportHeight = globalThis.window.innerHeight;
		const viewportWidth = globalThis.window.innerWidth;

		let resolved: TooltipPlacement = placement;
		if (
			resolved === "top" &&
			triggerRect.top - tooltipRect.height - TRIGGER_OFFSET < 0
		) {
			resolved = "bottom";
		} else if (
			resolved === "bottom" &&
			triggerRect.bottom + tooltipRect.height + TRIGGER_OFFSET > viewportHeight
		) {
			resolved = "top";
		}

		const top =
			resolved === "top"
				? triggerRect.top - tooltipRect.height - TRIGGER_OFFSET
				: triggerRect.bottom + TRIGGER_OFFSET;

		const triggerCenter = triggerRect.left + triggerRect.width / 2;
		const minLeft = VIEWPORT_GUTTER;
		const maxLeft = viewportWidth - tooltipRect.width - VIEWPORT_GUTTER;
		let left = triggerCenter - tooltipRect.width / 2;
		if (left < minLeft) left = minLeft;
		if (left > maxLeft) left = maxLeft;

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
			show();
		},
		onMouseLeave: (event: MouseEvent<HTMLElement>) => {
			childProps.onMouseLeave?.(event);
			hide();
		},
		onFocus: (event: FocusEvent<HTMLElement>) => {
			childProps.onFocus?.(event);
			show();
		},
		onBlur: (event: FocusEvent<HTMLElement>) => {
			childProps.onBlur?.(event);
			hide();
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
					className="bg-muted text-foreground border border-border" style={{position: "fixed",
				top: position?.top ?? -9999,
				left: position?.left ?? -9999,
				margin: 0,
				maxWidth: 320,
				borderRadius: 8,
				boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25)",
				padding: "8px 10px",
				fontSize: 12,
				lineHeight: 1.4,
				visibility: position === null ? "hidden" : "visible"}}
				>
					{content}
				</div>
			)}
		</>
	);
}
