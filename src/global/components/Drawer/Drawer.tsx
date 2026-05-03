import {
	useBackdropClick,
	useBodyScrollLock,
	useDialogCancel,
	useDialogPhase,
	useMediaQuery,
} from "@/global/hooks";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import "./Drawer.css";
import type { DrawerProps, DrawerSide } from "@/global/components/Drawer/types";

const DEFAULT_DURATION_MS = 250;
const DEFAULT_EASING = "ease";
const DEFAULT_SIDE: DrawerSide = "right";

const SWIPE_DISMISS_PX = 120;
const SWIPE_DISMISS_PX_REDUCED = 80;
const SWIPE_VELOCITY_THRESHOLD = 0.45;

/**
 * Reusable side drawer built on the native HTML `<dialog>` element.
 *
 * `dialog.showModal()` provides for free:
 *   - Top-layer rendering (no portal needed; escapes ancestor `overflow`).
 *   - Focus trap.
 *   - Escape via the `cancel` event.
 *   - The `::backdrop` pseudo-element for the dim overlay.
 *
 * Visuals model Mantine's `<Drawer>`:
 *   - 250ms panel transform; 200ms backdrop fade (50ms shorter).
 *   - Multi-layer elevation shadow on the panel.
 *
 * The `useDialogPhase` machine keeps the dialog mounted long enough for
 * the close transition to run before `dialog.close()` fires.
 */
export function Drawer({
	isOpen,
	onClose,
	children,
	side = DEFAULT_SIDE,
	durationMs = DEFAULT_DURATION_MS,
	easing = DEFAULT_EASING,
	size,
	ariaLabel,
	closeOnBackdropClick = true,
	closeOnEscape = true,
	panelClassName = "",
	backdropClassName = "",
	swipeToClose = false,
	swipeHandleAriaLabel,
}: Readonly<DrawerProps>) {
	const { phase, dialogRef } = useDialogPhase({ isOpen, durationMs });
	const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

	const swipeEnabled = swipeToClose && side === "bottom";
	const handleLabel = swipeHandleAriaLabel ?? "Drag down to close";

	const [dragY, setDragY] = useState(0);
	const [isDragging, setIsDragging] = useState(false);
	const sessionRef = useRef(false);
	const startYRef = useRef(0);
	const startTRef = useRef(0);

	useEffect(() => {
		if (!isOpen) {
			setDragY(0);
			setIsDragging(false);
			sessionRef.current = false;
		}
	}, [isOpen]);

	useDialogCancel(dialogRef, onClose, {
		enabled: phase !== "closed" && closeOnEscape,
	});
	useBackdropClick(dialogRef, onClose, {
		enabled: phase !== "closed" && closeOnBackdropClick,
	});
	useBodyScrollLock(phase !== "closed");

	const dialogStyle = useMemo<CSSProperties>(() => {
		const style: CSSProperties = {};
		if (size) {
			(style as Record<string, string>)["--drawer-size"] = size;
		}
		if (durationMs !== DEFAULT_DURATION_MS || easing !== DEFAULT_EASING) {
			style.transition = `transform ${durationMs}ms ${easing}`;
		}
		return style;
	}, [size, durationMs, easing]);

	const innerStyle: CSSProperties | undefined = swipeEnabled
		? {
				transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
				transition: isDragging ? "none" : "transform 0.2s ease-out",
			}
		: undefined;

	const onSwipePointerDown = useCallback(
		(e: PointerEvent<HTMLButtonElement>) => {
			if (!swipeEnabled) return;
			if (e.pointerType === "mouse" && e.button !== 0) return;
			e.currentTarget.setPointerCapture(e.pointerId);
			sessionRef.current = true;
			startYRef.current = e.clientY;
			startTRef.current = performance.now();
			setIsDragging(true);
			if (!prefersReducedMotion) {
				setDragY(0);
			}
		},
		[swipeEnabled, prefersReducedMotion]
	);

	const onSwipePointerMove = useCallback(
		(e: PointerEvent<HTMLButtonElement>) => {
			if (!swipeEnabled || !sessionRef.current || prefersReducedMotion) return;
			const dy = e.clientY - startYRef.current;
			setDragY(Math.max(0, dy));
		},
		[swipeEnabled, prefersReducedMotion]
	);

	const endSwipe = useCallback(
		(e: PointerEvent<HTMLButtonElement>) => {
			if (!swipeEnabled || !sessionRef.current) return;
			try {
				e.currentTarget.releasePointerCapture(e.pointerId);
			} catch {
				/* already released */
			}
			sessionRef.current = false;
			setIsDragging(false);

			const delta = e.clientY - startYRef.current;
			const elapsed = Math.max(1, performance.now() - startTRef.current);
			const velocity = delta / elapsed;
			const threshold = prefersReducedMotion ? SWIPE_DISMISS_PX_REDUCED : SWIPE_DISMISS_PX;
			const dismiss =
				delta >= threshold || (delta >= 56 && velocity >= SWIPE_VELOCITY_THRESHOLD);

			if (dismiss) {
				onClose();
			}
			setDragY(0);
		},
		[swipeEnabled, onClose, prefersReducedMotion]
	);

	if (phase === "closed") return null;

	return (
		<dialog
			ref={dialogRef}
			data-state={phase}
			data-side={side}
			data-backdrop-class={backdropClassName || undefined}
			className={`tavli-drawer ${panelClassName}`.trim()}
			style={dialogStyle}
			aria-label={ariaLabel}
		>
			<div className="tavli-drawer__inner" style={innerStyle}>
				{swipeEnabled ? (
					<button
						type="button"
						tabIndex={-1}
						aria-label={handleLabel}
						className="tavli-drawer-swipe-handle flex w-full shrink-0 cursor-grab justify-center border-0 bg-transparent py-2.5 touch-none"
						onPointerDown={onSwipePointerDown}
						onPointerMove={onSwipePointerMove}
						onPointerUp={endSwipe}
						onPointerCancel={endSwipe}
					>
						<span className="block h-1 w-10 rounded-full bg-muted-foreground/40" aria-hidden />
					</button>
				) : null}
				{children}
			</div>
		</dialog>
	);
}
