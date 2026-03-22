import type { ReactNode } from "react";

/**
 * Available modal sizes
 */
export type ModalSize = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl" | "full";

/**
 * Props for the Modal component
 */
export interface ModalProps {
	/**
	 * Whether the modal is open
	 */
	isOpen: boolean;

	/**
	 * Callback when the modal should be closed
	 */
	onClose: () => void;

	/**
	 * Content to render inside the modal
	 */
	children: ReactNode;

	/**
	 * Preset size for the modal
	 * @default "lg"
	 */
	size?: ModalSize;

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

	/**
	 * Custom class name for the backdrop
	 */
	backdropClassName?: string;

	/**
	 * Custom class name for the modal container
	 */
	containerClassName?: string;

	/**
	 * Custom class name for the modal content wrapper
	 */
	contentClassName?: string;

	/**
	 * ARIA label for the modal
	 */
	ariaLabel?: string;

	/**
	 * ARIA labelledby for the modal (alternative to ariaLabel)
	 */
	ariaLabelledBy?: string;

	/**
	 * ARIA describedby for the modal
	 */
	ariaDescribedBy?: string;
}
