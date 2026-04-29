interface TableSkeletonProps {
	readonly rows?: number;
}

export function TableSkeleton({ rows = 5 }: TableSkeletonProps) {
	return (
		<div className="space-y-3">
			{Array.from({ length: rows }, (_, i) => (
				<div
					key={`skeleton-row-${i}`}
					className="h-12 rounded-lg animate-pulse bg-hover"
					
				/>
			))}
		</div>
	);
}
