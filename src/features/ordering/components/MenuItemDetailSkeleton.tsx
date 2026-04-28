import { Skeleton } from "@/global/components";
import { ArrowLeft } from "lucide-react";

const OPTION_GROUPS = 2;
const OPTIONS_PER_GROUP = 3;

interface MenuItemDetailSkeletonProps {
	readonly onBack?: () => void;
}

export function MenuItemDetailSkeleton({ onBack }: MenuItemDetailSkeletonProps = {}) {
	return (
		<div className="flex flex-col h-full" aria-label="Loading menu item" aria-busy="true">
			<div className="flex-1 overflow-y-auto p-4 space-y-6">
				{onBack ? (
					<button
						onClick={onBack}
						className="flex items-center gap-1 text-sm"
						style={{ color: "var(--btn-primary-bg)" }}
					>
						<ArrowLeft size={16} /> Back to menu
					</button>
				) : (
					<Skeleton className="h-4 w-28" />
				)}

				<div className="space-y-3">
					<Skeleton className="h-6 w-3/5" />
					<Skeleton className="h-4 w-4/5" />
					<Skeleton className="h-4 w-3/5" />
					<Skeleton className="h-5 w-20" />
				</div>

				{Array.from({ length: OPTION_GROUPS }, (_, groupIndex) => (
					<div key={`option-group-${groupIndex}`} className="space-y-2">
						<Skeleton className="h-4 w-32" />
						{Array.from({ length: OPTIONS_PER_GROUP }, (_, optIndex) => (
							<div
								key={`option-group-${groupIndex}-opt-${optIndex}`}
								className="flex items-center justify-between px-3 py-2.5 rounded-lg"
								style={{
									backgroundColor: "var(--bg-secondary)",
									border: "1px solid var(--border-default)",
								}}
							>
								<Skeleton
									className="h-4"
									style={{ width: `${40 + (optIndex % 3) * 12}%` }}
								/>
								<Skeleton className="h-4 w-12" />
							</div>
						))}
					</div>
				))}
			</div>

			<div
				className="px-4 pb-4 pt-2 space-y-3"
				style={{ borderTop: "1px solid var(--border-default)" }}
			>
				<div className="flex items-center justify-center gap-4">
					<Skeleton rounded="full" className="h-9 w-9" />
					<Skeleton className="h-5 w-6" />
					<Skeleton rounded="full" className="h-9 w-9" />
				</div>
				<Skeleton rounded="xl" className="h-12 w-full" />
			</div>
		</div>
	);
}
