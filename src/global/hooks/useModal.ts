import { useEffect, useRef, type RefObject } from "react";

/**
 * Configuration options for the useModal hook
 */
export interface UseModalOptions {
	/**
	 * Whether the modal is open
	 */
	isOpen: boolean;

	/**
	 * Callback when the modal should be closed
	 */
	onClose: () => void;

	/**
	 * Whether to close the modal when clicking the backdrop
	 * @default true
	 */
	closeOnBackdropClick?: boolean;

	/**
	 * Whether to close the modal when pressing Escape
	 * @default true
	 */
	closeOnEscape?: boolean;

	/**
	 * Whether to trap focus within the modal
	 * @default true
	 */
	trapFocus?: boolean;
}

/**
 * Hook to control dialog open/close state
 */
function useDialogOpen(modalRef: RefObject<HTMLDialogElement | null>, isOpen: boolean) {
	useEffect(() => {
		const dialog = modalRef.current;
		if (!dialog) {
			// If dialog is not yet available and we want to open it,
			// wait a tick for the DOM to update
			if (isOpen) {
				// Use requestAnimationFrame to ensure DOM is ready
				const timeoutId = requestAnimationFrame(() => {
					const dialogAfterFrame = modalRef.current;
					if (dialogAfterFrame) {
						dialogAfterFrame.showModal();
					}
				});
				return () => cancelAnimationFrame(timeoutId);
			}
			return;
		}

		if (isOpen) {
			dialog.showModal();
		} else {
			dialog.close();
		}
	}, [modalRef, isOpen]);
}

/**
 * Hook to lock body scroll when modal is open
 */
function useBodyScrollLock(enabled: boolean) {
	useEffect(() => {
		if (!enabled) return;

		const originalOverflow = globalThis.window.getComputedStyle(document.body).overflow;
		document.body.style.overflow = "hidden";

		return () => {
			document.body.style.overflow = originalOverflow;
		};
	}, [enabled]);
}

/**
 * Hook to handle Escape key to close modal
 */
function useEscapeToClose(
	modalRef: RefObject<HTMLDialogElement | null>,
	enabled: boolean,
	onClose: () => void
) {
	useEffect(() => {
		const dialog = modalRef.current;
		if (!dialog || !enabled) return;

		const handleCancel = (event: Event) => {
			event.preventDefault();
			onClose();
		};

		dialog.addEventListener("cancel", handleCancel);
		return () => {
			dialog.removeEventListener("cancel", handleCancel);
		};
	}, [modalRef, enabled, onClose]);
}

/**
 * Hook to handle backdrop click to close modal
 * Note: For dialog elements, clicks on ::backdrop don't trigger onClick on the dialog itself.
 * We need to check if the click target is the dialog element (not its children).
 */
function useBackdropClick(
	modalRef: RefObject<HTMLDialogElement | null>,
	enabled: boolean,
	onClose: () => void
) {
	useEffect(() => {
		const dialog = modalRef.current;
		if (!dialog || !enabled) return;

		const handleBackdropClick = (event: MouseEvent) => {
			// Check if click is directly on the dialog element (backdrop area)
			if (event.target === dialog) {
				onClose();
			}
		};

		dialog.addEventListener("click", handleBackdropClick);
		return () => {
			dialog.removeEventListener("click", handleBackdropClick);
		};
	}, [modalRef, enabled, onClose]);
}

/**
 * Hook to trap focus within the modal and restore focus on close
 */
function useFocusTrap(
	modalRef: RefObject<HTMLDialogElement | null>,
	enabled: boolean,
	isOpen: boolean
) {
	const previousActiveElementRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		const dialog = modalRef.current;
		if (!dialog || !enabled || !isOpen) return;

		// Function to get all focusable elements (re-query on each tab to handle dynamic content)
		const getFocusableElements = (): HTMLElement[] => {
			return Array.from(
				dialog.querySelectorAll<HTMLElement>(
					'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
				)
			).filter((el) => {
				// Filter out elements that are not visible or have display: none
				const style = globalThis.window.getComputedStyle(el);
				return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
			});
		};

		// Store the previously active element
		if (document.activeElement instanceof HTMLElement) {
			previousActiveElementRef.current = document.activeElement;
		}

		// Get initial focusable elements and focus the first one
		const initialFocusableElements = getFocusableElements();
		if (initialFocusableElements.length > 0) {
			initialFocusableElements[0].focus();
		}

		const handleTab = (event: KeyboardEvent) => {
			if (event.key !== "Tab") return;

			// Re-query focusable elements to handle dynamically added content
			const focusableElements = getFocusableElements();
			if (focusableElements.length === 0) return;

			const firstElement = focusableElements[0];
			const lastElement = focusableElements.at(-1);
			if (!lastElement) return;

			const currentIndex = focusableElements.indexOf(document.activeElement as HTMLElement);

			if (event.shiftKey) {
				// Shift + Tab
				if (currentIndex === 0 || currentIndex === -1) {
					event.preventDefault();
					lastElement.focus();
				}
				return;
			}
			// Tab
			if (currentIndex === focusableElements.length - 1 || currentIndex === -1) {
				event.preventDefault();
				firstElement.focus();
			}
		};

		document.addEventListener("keydown", handleTab);

		return () => {
			document.removeEventListener("keydown", handleTab);

			// Restore focus to the previously active element
			if (previousActiveElementRef.current) {
				previousActiveElementRef.current.focus();
			}
		};
	}, [modalRef, enabled, isOpen]);

	return previousActiveElementRef;
}

/**
 * Custom hook that manages all modal behavior including:
 * - Escape key handling
 * - Body scroll lock
 * - Focus trap
 * - Backdrop click handling
 * - Dialog open/close state control
 *
 * @param options - Configuration options for the modal
 * @returns A ref to attach to the dialog element
 */
export function useModal({
	isOpen,
	onClose,
	closeOnBackdropClick = true,
	closeOnEscape = true,
	trapFocus = true,
}: UseModalOptions) {
	const modalRef = useRef<HTMLDialogElement>(null);

	// Split effects by responsibility
	useDialogOpen(modalRef, isOpen);
	useBodyScrollLock(isOpen);
	useEscapeToClose(modalRef, closeOnEscape && isOpen, onClose);
	useBackdropClick(modalRef, closeOnBackdropClick && isOpen, onClose);
	useFocusTrap(modalRef, trapFocus, isOpen);

	return modalRef;
}
