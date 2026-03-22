export function LoadingSkeleton() {
	return (
		<div className="space-y-3">
			{Array.from({ length: 5 }, (_, i) => (
				<div
					key={`skeleton-row-${i}`}
					className="h-12 rounded-lg animate-pulse"
					style={{ backgroundColor: "var(--bg-hover)" }}
				/>
			))}
		</div>
	);
}




