import { useModal } from "@/global";
import { createPortal } from "react-dom";
import type { ModalProps, ModalSize } from "./types";

/**
 * Size class mappings for the modal container
 */
const SIZE_CLASSES: Record<ModalSize, string> = {
	sm: "max-w-sm",
	md: "max-w-md",
	lg: "max-w-lg",
	xl: "max-w-xl",
	"2xl": "max-w-2xl",
	"3xl": "max-w-3xl",
	"4xl": "max-w-4xl",
	"5xl": "max-w-5xl",
	full: "max-w-full mx-4",
};

/**
 * Headless Modal Component
 *
 * A fully headless modal component that provides structure and functionality
 * without imposing styling. You can inject any components as children and
 * style them according to your design system.
 *
 * Features:
 * - Portal rendering (renders outside normal DOM hierarchy)
 * - Backdrop click to close
 * - Escape key to close
 * - Focus trap (keeps focus within modal)
 * - Body scroll lock when open
 * - ARIA attributes for accessibility
 * - Configurable size presets (sm, md, lg, xl, 2xl, 3xl, 4xl, 5xl, full)
 *
 * @example
 * ```tsx
 * <Modal
 *   isOpen={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   ariaLabel="Example Modal"
 *   size="2xl"
 * >
 *   <div className="p-6 bg-white/5 rounded-xl border border-white/5">
 *     <h2 className="text-xl font-semibold text-white mb-4">Modal Title</h2>
 *     <p className="text-gray-400 mb-4">Modal content goes here</p>
 *     <button onClick={() => setIsOpen(false)}>Close</button>
 *   </div>
 * </Modal>
 * ```
 */
export function Modal(props: Readonly<ModalProps>) {
	const modalRef = useModal({ ...props });

	if (!props.isOpen) return null;

	const sizeClass = SIZE_CLASSES[props.size ?? "lg"];
	const backdropClasses = `absolute inset-0 flex items-center justify-center p-4 bg-black/50 ${props.backdropClassName || ""}`;
	const containerClasses = `relative z-10 w-full max-h-full overflow-y-auto ${sizeClass} ${props.containerClassName || ""}`;
	const contentClasses = `relative ${props.contentClassName || ""}`;

	const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
		// Only close if clicking directly on the backdrop, not on its children
		if (e.target === e.currentTarget && props.closeOnBackdropClick !== false) {
			props.onClose();
		}
	};

	const handleBackdropKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
		// Keyboard support for accessibility (Escape is already handled by dialog element)
		// This handler satisfies linter requirements for clickable elements
		if (e.key === "Escape" && props.closeOnEscape !== false) {
			props.onClose();
		}
	};

	const modalContent = (
		<dialog
			ref={modalRef}
			className="fixed inset-0 z-50 m-0 p-0 w-screen h-screen max-w-none max-h-none border-0 bg-transparent"
			aria-label={props.ariaLabel}
			aria-labelledby={props.ariaLabelledBy}
			aria-describedby={props.ariaDescribedBy}
		>
			<div
				className={backdropClasses}
				onClick={handleBackdropClick}
				onKeyDown={handleBackdropKeyDown}
				tabIndex={-1}
				role="none"
			>
				<div className={containerClasses}>
					<div className={contentClasses}>{props.children}</div>
				</div>
			</div>
		</dialog>
	);

	// Render to portal (outside normal DOM hierarchy)
	if (globalThis.window !== undefined) {
		return createPortal(modalContent, document.body);
	}

	return null;
}
