import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
	readonly icon?: LucideIcon;
	readonly title: string;
	readonly description?: string;
	readonly action?: ReactNode;
	readonly variant?: "card" | "inline";
	/**
	 * When true, the card variant grows to fill the remaining vertical space of
	 * its parent instead of sitting at its natural height. The parent must be a
	 * flex column with a defined or `min-h-full` height for this to take
	 * effect. Has no effect on the inline variant.
	 */
	readonly fill?: boolean;
	readonly className?: string;
}

export function EmptyState({
	icon: Icon,
	title,
	description,
	action,
	variant = "card",
	fill = false,
	className = "",
}: EmptyStateProps) {
	if (variant === "inline") {
		return (
			<p className={`${`text-sm py-4 text-center ${className}`} text-faint-foreground`} >
				{title}
			</p>
		);
	}

	const sizing = fill ? "flex-1 self-stretch min-h-0 py-12" : "py-12";

	return (
		<div
			className={`${`flex flex-col items-center justify-center rounded-lg ${sizing} ${className}`} bg-muted`}
		 
		>
			{Icon && (
				<div
					className="w-16 h-16 rounded-full flex items-center justify-center mb-4 bg-hover"
					
				>
					<Icon size={24} className="text-faint-foreground"  />
				</div>
			)}
			<p className="text-lg font-medium text-foreground" >
				{title}
			</p>
			{description && (
				<p className="text-sm mt-1 text-center max-w-md text-muted-foreground" >
					{description}
				</p>
			)}
			{action && <div className="mt-4">{action}</div>}
		</div>
	);
}
