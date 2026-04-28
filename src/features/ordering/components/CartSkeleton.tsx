import { Skeleton } from "@/global/components";
import { ArrowLeft } from "lucide-react";

const ITEM_COUNT = 3;

interface CartSkeletonProps {
	readonly onBack?: () => void;
}

export function CartSkeleton({ onBack }: CartSkeletonProps = {}) {
	return (
		<div className="flex flex-col h-full" aria-label="Loading cart" aria-busy="true">
			<div className="flex-1 overflow-y-auto p-4 space-y-4">
				{onBack ? (
					<button
						onClick={onBack}
						className="flex items-center gap-1 text-sm"
						style={{ color: "var(--btn-primary-bg)" }}
					>
						<ArrowLeft size={16} /> Back to menu
					</button>
				) : (
					<Skeleton className="h-4 w-24" />
				)}

				<Skeleton className="h-6 w-32" />

				<div className="space-y-3">
					{Array.from({ length: ITEM_COUNT }, (_, i) => (
						<div
							key={`cart-item-${i}`}
							className="flex items-start justify-between px-4 py-3 rounded-xl"
							style={{ backgroundColor: "var(--bg-secondary)" }}
						>
							<div className="flex-1 space-y-2">
								<Skeleton className="h-4" style={{ width: `${50 + (i % 3) * 12}%` }} />
								<Skeleton className="h-3 w-32" />
							</div>
							<div className="flex items-center gap-2">
								<Skeleton className="h-4 w-12" />
								<Skeleton rounded="md" className="h-6 w-6" />
							</div>
						</div>
					))}
				</div>
			</div>

			<div
				className="px-4 pb-4 pt-3 space-y-3"
				style={{ borderTop: "1px solid var(--border-default)" }}
			>
				<div className="flex items-center justify-between">
					<Skeleton className="h-5 w-16" />
					<Skeleton className="h-5 w-20" />
				</div>
				<Skeleton rounded="xl" className="h-12 w-full" />
			</div>
		</div>
	);
}
