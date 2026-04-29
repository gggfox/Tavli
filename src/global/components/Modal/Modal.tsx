import {
	useBackdropClick,
	useBodyScrollLock,
	useDialogCancel,
	useDialogPhase,
} from "@/global/hooks";
import "./Modal.css";
import type { ModalProps, ModalSize } from "./types";

const SIZE_CLASSES: Record<ModalSize, string> = {
	sm: "w-full max-w-sm",
	md: "w-full max-w-md",
	lg: "w-full max-w-lg",
	xl: "w-full max-w-xl",
	"2xl": "w-full max-w-2xl",
	"3xl": "w-full max-w-3xl",
	"4xl": "w-full max-w-4xl",
	"5xl": "w-full max-w-5xl",
	full: "w-full max-w-full mx-4",
};

/**
 * Headless Modal built on the native HTML `<dialog>` element.
 *
 * `dialog.showModal()` provides for free:
 *   - Top-layer rendering (no portal needed; escapes ancestor `overflow`).
 *   - Focus trap.
 *   - Escape via the `cancel` event.
 *   - The `::backdrop` pseudo-element for the dim overlay.
 *
 * The phase machine in `useDialogPhase` keeps the dialog mounted long
 * enough for CSS-driven open/close transitions to play.
 *
 * @example
 * ```tsx
 * <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} ariaLabel="Settings" size="2xl">
 *   <div className="p-6 bg-white rounded-xl">...</div>
 * </Modal>
 * ```
 */
export function Modal(props: Readonly<ModalProps>) {
	const { phase, dialogRef } = useDialogPhase({ isOpen: props.isOpen });

	useDialogCancel(dialogRef, props.onClose, {
		enabled: phase !== "closed" && props.closeOnEscape !== false,
	});
	useBackdropClick(dialogRef, props.onClose, {
		enabled: phase !== "closed" && props.closeOnBackdropClick !== false,
	});
	useBodyScrollLock(phase !== "closed");

	if (phase === "closed") return null;

	const sizeClass = SIZE_CLASSES[props.size ?? "lg"];
	const dialogClassName = [
		"tavli-modal",
		sizeClass,
		props.containerClassName ?? "",
		props.backdropClassName ?? "",
	]
		.filter(Boolean)
		.join(" ");
	const contentClassName = ["tavli-modal-content", props.contentClassName ?? ""]
		.filter(Boolean)
		.join(" ");

	return (
		<dialog
			ref={dialogRef}
			data-state={phase}
			className={dialogClassName}
			aria-label={props.ariaLabel}
			aria-labelledby={props.ariaLabelledBy}
			aria-describedby={props.ariaDescribedBy}
		>
			<div className={contentClassName}>{props.children}</div>
		</dialog>
	);
}
