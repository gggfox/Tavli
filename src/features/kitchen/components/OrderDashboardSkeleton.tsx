import { Skeleton } from "@/global/components";

const PLACEHOLDER_CARDS = 6;
const PLACEHOLDER_ROWS_PER_CARD = 3;

export function OrderDashboardSkeleton() {
	return (
		<div
			className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
			aria-label="Loading orders"
			aria-busy="true"
		>
			{Array.from({ length: PLACEHOLDER_CARDS }, (_, cardIndex) => (
				<div
					key={`order-skeleton-${cardIndex}`}
					className="rounded-xl overflow-hidden flex flex-col aspect-video"
					style={{
						border: "1px solid var(--border-default)",
						backgroundColor: "var(--bg-secondary)",
					}}
				>
					<div
						className="px-4 py-3 flex items-start justify-between gap-2"
						style={{ borderBottom: "1px solid var(--border-default)" }}
					>
						<div className="flex items-center gap-2 min-w-0 flex-1">
							<Skeleton rounded="full" className="h-5 w-16" />
							<Skeleton className="h-4 w-20" />
						</div>
						<div className="flex flex-col items-end gap-1.5">
							<Skeleton className="h-4 w-12" />
							<Skeleton className="h-3 w-14" />
						</div>
					</div>

					<div className="p-4 space-y-2 flex-1">
						{Array.from({ length: PLACEHOLDER_ROWS_PER_CARD }, (_, rowIndex) => (
							<Skeleton
								key={`order-skeleton-${cardIndex}-row-${rowIndex}`}
								className="h-4"
								style={{ width: `${60 + ((cardIndex + rowIndex) % 4) * 10}%` }}
							/>
						))}
					</div>

					<div className="px-4 pb-4 flex gap-2">
						<Skeleton rounded="lg" className="h-9 flex-1" />
						<Skeleton rounded="lg" className="h-9 w-20" />
					</div>
				</div>
			))}
		</div>
	);
}
