import { Skeleton } from "@/global/components";

export function ReservationsDashboardSkeleton() {
	return (
		<div className="space-y-4">
			<Skeleton rounded="lg" className="h-10 w-full max-w-md" />
			<div className="space-y-2">
				{[0, 1, 2, 3, 4].map((i) => (
					<Skeleton key={i} rounded="xl" className="h-20 w-full" />
				))}
			</div>
		</div>
	);
}
