import { Skeleton } from "@/global/components";

const CATEGORY_COUNT = 3;
const ITEMS_PER_CATEGORY = 4;

export function MenuEditorSkeleton() {
	return (
		<div className="space-y-6" aria-label="Loading menu editor" aria-busy="true">
			<div className="flex items-center gap-3">
				<Skeleton rounded="lg" className="h-9 w-32" />
				<Skeleton rounded="lg" className="h-9 w-24" />
				<Skeleton rounded="lg" className="h-9 w-24" />
			</div>

			<div className="flex gap-3">
				<Skeleton rounded="lg" className="h-10 flex-1" />
				<Skeleton rounded="lg" className="h-10 w-36" />
			</div>

			{Array.from({ length: CATEGORY_COUNT }, (_, catIndex) => (
				<div
					key={`menu-cat-${catIndex}`}
					className="rounded-xl p-4 space-y-3"
					style={{
						backgroundColor: "var(--bg-secondary)",
						border: "1px solid var(--border-default)",
					}}
				>
					<div className="flex items-center justify-between">
						<Skeleton className="h-5" style={{ width: `${100 + (catIndex % 3) * 30}px` }} />
						<Skeleton rounded="md" className="h-7 w-7" />
					</div>
					<div className="space-y-2">
						{Array.from({ length: ITEMS_PER_CATEGORY }, (_, itemIndex) => (
							<div
								key={`menu-cat-${catIndex}-item-${itemIndex}`}
								className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
								style={{ backgroundColor: "var(--bg-primary)" }}
							>
								<Skeleton rounded="md" className="h-10 w-10 shrink-0" />
								<div className="flex-1 space-y-2">
									<Skeleton className="h-4" style={{ width: `${50 + (itemIndex % 3) * 12}%` }} />
									<Skeleton className="h-3 w-16" />
								</div>
								<Skeleton className="h-4 w-12" />
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	);
}
