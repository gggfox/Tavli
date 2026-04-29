import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./Drawer.css";
import type { DrawerProps, DrawerSide } from "./types";

type Phase = "closed" | "preparing" | "open" | "closing";

const DEFAULT_DURATION_MS = 250;
const DEFAULT_EASING = "ease";
const DEFAULT_SIDE: DrawerSide = "right";

const FOCUSABLE_SELECTOR =
	'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Reusable side drawer.
 *
 * Visual design and timing are modeled after Mantine's `<Drawer>`:
 *  - Multi-layer elevation shadow on the panel.
 *  - 250ms transform on the panel, 200ms opacity on the overlay.
 *  - Flex inner wrapper positions the panel against the requested edge,
 *    so `top`/`bottom` drawers stretch to full width and `left`/`right`
 *    drawers stretch to full height.
 *
 * Renders into a portal on `document.body` so the panel always sits above
 * ancestor `overflow` containers (sidebar, scroll regions, etc.). The
 * close animation runs to completion before the component unmounts.
 *
 * Closes on backdrop click, Escape, or any external `isOpen` toggle. Locks
 * body scroll while open and traps Tab focus inside the panel, restoring
 * focus to the previously active element on close.
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
}: Readonly<DrawerProps>) {
	const [phase, setPhase] = useState<Phase>("closed");
	const panelRef = useRef<HTMLDialogElement | null>(null);
	const previousActiveRef = useRef<HTMLElement | null>(null);

	// Drive phase transitions from the `isOpen` prop. Crucially, this effect
	// must NOT also schedule the close timeout: doing both `setPhase("closing")`
	// AND `setTimeout(...)` in the same effect causes the cleanup (which depends
	// on `phase`) to clear the timeout the moment the next render commits with
	// `phase === "closing"`. The drawer would then get stuck mounted with an
	// invisible-but-clickable backdrop intercepting every subsequent trigger
	// click, which is exactly the "drawer only opens once" symptom.
	useEffect(() => {
		if (isOpen) {
			setPhase((current) =>
				current === "open" || current === "preparing" ? current : "preparing"
			);
		} else {
			setPhase((current) =>
				current === "closed" || current === "closing" ? current : "closing"
			);
		}
	}, [isOpen]);

	useEffect(() => {
		if (phase !== "closing") return;
		const timeout = globalThis.window.setTimeout(() => setPhase("closed"), durationMs);
		return () => globalThis.window.clearTimeout(timeout);
	}, [phase, durationMs]);

	useEffect(() => {
		if (phase !== "preparing") return;
		let id2: number | null = null;
		const id1 = requestAnimationFrame(() => {
			id2 = requestAnimationFrame(() => setPhase("open"));
		});
		return () => {
			cancelAnimationFrame(id1);
			if (id2 !== null) cancelAnimationFrame(id2);
		};
	}, [phase]);

	useEffect(() => {
		if (phase === "closed") return;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = previousOverflow;
		};
	}, [phase]);

	useEffect(() => {
		if (!closeOnEscape || phase === "closed") return;
		const handler = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				onClose();
			}
		};
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, [closeOnEscape, onClose, phase]);

	useEffect(() => {
		if (phase !== "preparing" && phase !== "open") return;
		const panel = panelRef.current;
		if (!panel) return;

		if (document.activeElement instanceof HTMLElement) {
			previousActiveRef.current = document.activeElement;
		}

		const initialFocusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
		initialFocusables[0]?.focus();

		const handleTab = (event: KeyboardEvent) => {
			if (event.key !== "Tab") return;
			const items = Array.from(
				panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
			).filter((el) => {
				const style = globalThis.window.getComputedStyle(el);
				return style.visibility !== "hidden" && style.display !== "none";
			});
			if (items.length === 0) return;
			const firstItem = items[0];
			const lastItem = items.at(-1);
			if (!lastItem) return;
			const active = document.activeElement as HTMLElement | null;
			if (event.shiftKey && active === firstItem) {
				event.preventDefault();
				lastItem.focus();
			} else if (!event.shiftKey && active === lastItem) {
				event.preventDefault();
				firstItem.focus();
			}
		};

		document.addEventListener("keydown", handleTab);
		return () => {
			document.removeEventListener("keydown", handleTab);
			previousActiveRef.current?.focus();
		};
	}, [phase]);

	const handleBackdropClick = useCallback(() => {
		if (closeOnBackdropClick) onClose();
	}, [closeOnBackdropClick, onClose]);

	const handleBackdropKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLButtonElement>) => {
			if (event.key === "Escape" && closeOnEscape) {
				event.preventDefault();
				onClose();
			}
		},
		[closeOnEscape, onClose]
	);

	const panelStyle = useMemo<React.CSSProperties>(() => {
		const style: React.CSSProperties = {};
		if (size) {
			(style as Record<string, string>)["--drawer-size"] = size;
		}
		if (durationMs !== DEFAULT_DURATION_MS || easing !== DEFAULT_EASING) {
			style.transition = `transform ${durationMs}ms ${easing}`;
		}
		return style;
	}, [size, durationMs, easing]);

	// Mantine pairs a 250ms content transform with a 200ms overlay fade; mirror
	// that 50ms-shorter ratio when consumers override the duration so the
	// overlay finishes fading slightly before the panel finishes sliding.
	const backdropStyle = useMemo<React.CSSProperties>(() => {
		if (durationMs === DEFAULT_DURATION_MS && easing === DEFAULT_EASING) return {};
		const overlayDuration = Math.max(150, durationMs - 50);
		return { transition: `opacity ${overlayDuration}ms ${easing}` };
	}, [durationMs, easing]);

	if (phase === "closed") return null;
	if (globalThis.window === undefined) return null;

	const overlayState = phase === "open" ? "open" : "preparing";

	return createPortal(
		<>
			<button
				type="button"
				aria-label="Close drawer"
				className={`tavli-drawer-overlay ${backdropClassName}`.trim()}
				data-state={overlayState}
				style={backdropStyle}
				onClick={handleBackdropClick}
				onKeyDown={handleBackdropKeyDown}
				tabIndex={-1}
			/>
			<div className="tavli-drawer-inner" data-side={side} data-state={phase}>
				<dialog
					ref={panelRef}
					open
					aria-label={ariaLabel}
					aria-modal="true"
					className={`tavli-drawer-content ${panelClassName}`.trim()}
					style={panelStyle}
				>
					{children}
				</dialog>
			</div>
		</>,
		document.body
	);
}
