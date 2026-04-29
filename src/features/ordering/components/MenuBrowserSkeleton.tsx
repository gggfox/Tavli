import { Skeleton } from "@/global/components";

const TAB_COUNT = 3;
const CATEGORY_COUNT = 2;
const ITEMS_PER_CATEGORY = 6;

export function MenuBrowserSkeleton() {
	return (
		<div className="flex flex-col h-full" aria-label="Loading menu" aria-busy="true">
			<div className="flex gap-2 px-4 pt-4 overflow-x-auto">
				{Array.from({ length: TAB_COUNT }, (_, i) => (
					<Skeleton
						key={`tab-${i}`}
						rounded="full"
						className="h-9 shrink-0"
						style={{width: `${88 + (i % 3) * 14}px`}}
					/>
				))}
			</div>

			<div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
				{Array.from({ length: CATEGORY_COUNT }, (_, catIndex) => (
					<div key={`category-${catIndex}`} className="space-y-3">
						<Skeleton className="h-6" style={{width: `${120 + (catIndex % 2) * 30}px`}} />
						<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
							{Array.from({ length: ITEMS_PER_CATEGORY }, (_, itemIndex) => (
								<div
									key={`category-${catIndex}-item-${itemIndex}`}
									className="rounded-xl overflow-hidden flex flex-col bg-muted"
									
								>
									<Skeleton rounded="sm" className="w-full h-36 sm:h-40" />
									<div className="px-3 py-2.5 space-y-2">
										<Skeleton
											className="h-4"
											style={{width: `${55 + (itemIndex % 4) * 10}%`}}
										/>
										<Skeleton className="h-3" style={{width: `${75 - (itemIndex % 3) * 10}%`}} />
										<Skeleton className="h-4 w-16" />
									</div>
								</div>
							))}
						</div>
					</div>
				))}
			</div>

			<div
				className="shrink-0 px-4 py-4 text-center border-t border-border bg-background"
				
			>
				<Skeleton className="h-4 w-48 mx-auto" />
			</div>
		</div>
	);
}
