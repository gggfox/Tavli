import {
	type FocusEvent,
	type MouseEvent,
	type Ref,
	cloneElement,
	isValidElement,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
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
	"aria-describedby"?: string;
	onMouseEnter?: (event: MouseEvent<HTMLElement>) => void;
	onMouseLeave?: (event: MouseEvent<HTMLElement>) => void;
	onFocus?: (event: FocusEvent<HTMLElement>) => void;
	onBlur?: (event: FocusEvent<HTMLElement>) => void;
};

/**
 * Lightweight headless tooltip.
 *
 * Wraps a single trigger element and renders themed content into a portal
 * on `document.body` so it can escape clipping containers (e.g. tables with
 * `overflow: hidden`). Opens on hover and focus, closes on Escape, blur,
 * mouseleave, or pointerdown outside both the trigger and tooltip.
 *
 * Positioning prefers the requested `placement` and flips to the opposite
 * side if the tooltip would clip the viewport. Horizontal position is
 * centered on the trigger and clamped to a small viewport gutter.
 */
export function Tooltip({
	children,
	content,
	placement = "top",
	delay = 100,
	disabled = false,
}: Readonly<TooltipProps>) {
	const [isOpen, setIsOpen] = useState(false);
	const [position, setPosition] = useState<ResolvedPosition | null>(null);

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
		if (disabled) return;
		clearShowTimer();
		if (delay <= 0) {
			setIsOpen(true);
			return;
		}
		showTimerRef.current = setTimeout(() => setIsOpen(true), delay);
	}, [disabled, delay, clearShowTimer]);

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

	useEffect(() => {
		if (!isOpen) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") hide();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [isOpen, hide]);

	useEffect(() => {
		if (!isOpen) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (!target) return;
			if (triggerRef.current?.contains(target)) return;
			if (tooltipRef.current?.contains(target)) return;
			hide();
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [isOpen, hide]);

	useEffect(() => () => clearShowTimer(), [clearShowTimer]);

	if (!isValidElement<TriggerProps>(children)) {
		return children;
	}

	const childProps = children.props;
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

	const tooltipNode = (
		<div
			ref={tooltipRef}
			role="tooltip"
			id={tooltipId}
			style={{
				position: "fixed",
				top: position?.top ?? -9999,
				left: position?.left ?? -9999,
				zIndex: 60,
				maxWidth: 320,
				backgroundColor: "var(--bg-secondary)",
				color: "var(--text-primary)",
				border: "1px solid var(--border-default)",
				borderRadius: 8,
				boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25)",
				padding: "8px 10px",
				fontSize: 12,
				lineHeight: 1.4,
				visibility: position === null ? "hidden" : "visible",
			}}
		>
			{content}
		</div>
	);

	return (
		<>
			{wrappedChild}
			{isOpen && globalThis.window !== undefined
				? createPortal(tooltipNode, document.body)
				: null}
		</>
	);
}
