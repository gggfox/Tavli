interface LoadingStateProps {
	readonly message?: string;
	readonly variant?: "text" | "spinner" | "skeleton";
	readonly skeletonRows?: number;
	readonly className?: string;
}

export function LoadingState({
	message = "Loading...",
	variant = "text",
	skeletonRows = 5,
	className = "",
}: LoadingStateProps) {
	if (variant === "skeleton") {
		return (
			<div className={`space-y-3 ${className}`}>
				{Array.from({ length: skeletonRows }, (_, i) => (
					<div
						key={`skeleton-row-${i}`}
						className="h-12 rounded-lg animate-pulse bg-hover"
						
					/>
				))}
			</div>
		);
	}

	if (variant === "spinner") {
		return (
			<div className={`flex items-center justify-center p-8 ${className}`}>
				<div className="text-center">
					<div
						className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3 border border-accent"
						style={{borderTopColor: "transparent"}}
					/>
					<p className="text-muted-foreground" >{message}</p>
				</div>
			</div>
		);
	}

	return (
		<p className={`${`text-sm ${className}`} text-faint-foreground`} >
			{message}
		</p>
	);
}
