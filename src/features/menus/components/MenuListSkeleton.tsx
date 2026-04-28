import { Skeleton } from "@/global/components";

const ROWS = 4;

export function MenuListSkeleton() {
	return (
		<div className="space-y-4" aria-label="Loading menus" aria-busy="true">
			<div className="flex gap-3">
				<Skeleton rounded="lg" className="h-10 flex-1" />
				<Skeleton rounded="lg" className="h-10 w-32" />
			</div>
			<div className="space-y-2">
				{Array.from({ length: ROWS }, (_, i) => (
					<div
						key={`menu-row-${i}`}
						className="flex items-center justify-between px-4 py-3 rounded-lg"
						style={{
							backgroundColor: "var(--bg-secondary)",
							border: "1px solid var(--border-default)",
						}}
					>
						<Skeleton className="h-4" style={{ width: `${30 + (i % 3) * 12}%` }} />
						<div className="flex items-center gap-2">
							<Skeleton rounded="md" className="h-7 w-7" />
							<Skeleton rounded="md" className="h-7 w-7" />
							<Skeleton rounded="md" className="h-7 w-7" />
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
