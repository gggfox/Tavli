import { useMemo, type CSSProperties } from "react";
import {
	useBackdropClick,
	useBodyScrollLock,
	useDialogCancel,
	useDialogPhase,
} from "@/global/hooks";
import "./Drawer.css";
import type { DrawerProps, DrawerSide } from "./types";

const DEFAULT_DURATION_MS = 250;
const DEFAULT_EASING = "ease";
const DEFAULT_SIDE: DrawerSide = "right";

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
}: Readonly<DrawerProps>) {
	const { phase, dialogRef } = useDialogPhase({ isOpen, durationMs });

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
			{children}
		</dialog>
	);
}
