import { Skeleton } from "@/global/components";

const ROWS = 4;

export function AdminRestaurantsListSkeleton() {
	return (
		<div className="space-y-4" aria-label="Loading restaurants" aria-busy="true">
			<div className="flex justify-end">
				<Skeleton rounded="lg" className="h-9 w-40" />
			</div>

			<div className="space-y-2">
				{Array.from({ length: ROWS }, (_, i) => (
					<div
						key={`restaurant-${i}`}
						className="flex items-center justify-between px-4 py-3 rounded-lg"
						style={{
							backgroundColor: "var(--bg-secondary)",
							border: "1px solid var(--border-default)",
						}}
					>
						<div className="flex items-center gap-4">
							<div className="space-y-2">
								<Skeleton className="h-4" style={{ width: `${110 + (i % 3) * 22}px` }} />
								<Skeleton className="h-3 w-20" />
							</div>
							<Skeleton rounded="full" className="h-5 w-14" />
							<Skeleton className="h-3 w-10" />
						</div>
						<div className="flex items-center gap-2">
							<Skeleton rounded="md" className="h-7 w-7" />
							<Skeleton rounded="md" className="h-7 w-7" />
							<Skeleton rounded="lg" className="h-8 w-32" />
							<Skeleton rounded="md" className="h-7 w-7" />
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
