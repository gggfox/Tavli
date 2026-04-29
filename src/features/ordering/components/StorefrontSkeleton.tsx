import { Skeleton } from "@/global/components";

const RESTAURANT_GROUPS = 2;
const PRODUCTS_PER_GROUP = 3;

export function StorefrontSkeleton() {
	return (
		<div
			className="max-w-5xl mx-auto px-4 py-8 space-y-10"
			aria-label="Loading storefront"
			aria-busy="true"
		>
			<div className="text-center space-y-3">
				<Skeleton className="h-8 w-40 mx-auto" />
				<Skeleton className="h-4 w-72 mx-auto" />
			</div>

			{Array.from({ length: RESTAURANT_GROUPS }, (_, groupIndex) => (
				<section key={`store-group-${groupIndex}`} className="space-y-4">
					<div className="flex items-center gap-2">
						<Skeleton rounded="full" className="h-5 w-5" />
						<Skeleton className="h-5" style={{width: `${140 + (groupIndex % 2) * 40}px`}} />
					</div>
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{Array.from({ length: PRODUCTS_PER_GROUP }, (_, productIndex) => (
							<div
								key={`store-group-${groupIndex}-product-${productIndex}`}
								className="rounded-xl p-5 flex flex-col gap-4 bg-muted border border-border"
								
							>
								<div className="space-y-2">
									<Skeleton
										className="h-4"
										style={{width: `${55 + (productIndex % 3) * 12}%`}}
									/>
									<Skeleton className="h-3 w-full" />
									<Skeleton className="h-3 w-4/5" />
								</div>
								<div className="flex items-center justify-between mt-auto">
									<Skeleton className="h-6 w-20" />
									<Skeleton rounded="lg" className="h-9 w-24" />
								</div>
							</div>
						))}
					</div>
				</section>
			))}
		</div>
	);
}
