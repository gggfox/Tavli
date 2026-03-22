/**
 * StatusBadge component for displaying status indicators.
 *
 * A pure presentational component that accepts styling props.
 * Business logic and status configurations should be handled by the calling component.
 */

export interface StatusBadgeProps {
	/**
	 * Background color for the badge (e.g., "rgba(34, 197, 94, 0.15)")
	 */
	readonly bgColor: string;
	/**
	 * Text color for the badge (e.g., "rgb(34, 197, 94)")
	 */
	readonly textColor: string;
	/**
	 * Label text to display in the badge
	 */
	readonly label: string;
	/**
	 * Whether to show a border around the badge
	 */
	readonly showBorder?: boolean;
	/**
	 * Additional CSS classes to apply to the badge
	 */
	readonly className?: string;
}

/**
 * StatusBadge component for displaying status indicators.
 *
 * @example
 * <StatusBadge
 *   bgColor="rgba(34, 197, 94, 0.15)"
 *   textColor="rgb(34, 197, 94)"
 *   label="Approved"
 * />
 */
export function StatusBadge({
	bgColor,
	textColor,
	label,
	showBorder = false,
	className = "",
}: StatusBadgeProps) {
	const baseClasses = showBorder
		? "px-2 py-0.5 rounded-full text-xs font-medium border"
		: "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium";

	// Convert RGB to RGBA for border color
	const getBorderColor = (rgbColor: string): string => {
		// Extract RGB values from "rgb(r, g, b)" format
		const regex = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/;
		const match = regex.exec(rgbColor);
		if (match) {
			const [, r, g, b] = match;
			return `rgba(${r}, ${g}, ${b}, 0.3)`;
		}
		// Fallback if format doesn't match
		return rgbColor.replace("rgb", "rgba").replace(")", ", 0.3)");
	};

	const borderColor = showBorder
		? {
				borderColor: getBorderColor(textColor),
			}
		: {};

	return (
		<span
			className={`${baseClasses} ${className}`}
			style={{
				backgroundColor: bgColor,
				color: textColor,
				...borderColor,
			}}
		>
			{label}
		</span>
	);
}
