/**
 * DialogHeader — title + optional subtitle + close-X header used by
 * drawers and modal dialogs alike. Replaces the same hand-rolled
 * `px-6 py-4 flex items-start justify-between …` block that was
 * previously copy-pasted across the reservations route, the reservation
 * detail drawer, and the order detail modal.
 */
import { X } from "lucide-react";
import type { ReactNode } from "react";

export interface DialogHeaderProps {
	readonly title: ReactNode;
	readonly subtitle?: ReactNode;
	readonly onClose: () => void;
	/**
	 * Optional content rendered between the title block and the close
	 * button (e.g. a status badge, a paid pill, a count).
	 */
	readonly extra?: ReactNode;
	/**
	 * ARIA label for the close button. Defaults to "Close".
	 */
	readonly closeAriaLabel?: string;
	readonly className?: string;
}

export function DialogHeader({
	title,
	subtitle,
	onClose,
	extra,
	closeAriaLabel = "Close",
	className = "",
}: DialogHeaderProps) {
	const classes = ["px-6 py-4 flex items-start justify-between gap-4", className]
		.filter(Boolean)
		.join(" ");

	return (
		<div
			className={`${classes} border-b border-border`}
		 
		>
			<div className="flex flex-col gap-1 min-w-0">
				{typeof title === "string" ? (
					<h2 className="text-lg font-semibold text-foreground" >
						{title}
					</h2>
				) : (
					title
				)}
				{subtitle &&
					(typeof subtitle === "string" ? (
						<p className="text-xs text-muted-foreground" >
							{subtitle}
						</p>
					) : (
						subtitle
					))}
			</div>
			{extra && <div className="flex items-center gap-2 shrink-0">{extra}</div>}
			<button
				type="button"
				onClick={onClose}
				className="p-1 rounded-md transition-colors hover:opacity-80 shrink-0 text-faint-foreground"
				
				aria-label={closeAriaLabel}
			>
				<X size={18} />
			</button>
		</div>
	);
}
