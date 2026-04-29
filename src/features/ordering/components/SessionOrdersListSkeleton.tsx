import { Skeleton } from "@/global/components";
import { ArrowLeft } from "lucide-react";

const ROWS = 4;

interface SessionOrdersListSkeletonProps {
	readonly onBackToMenu?: () => void;
}

export function SessionOrdersListSkeleton({ onBackToMenu }: SessionOrdersListSkeletonProps = {}) {
	return (
		<div
			className="flex flex-col h-full overflow-y-auto"
			aria-label="Loading orders"
			aria-busy="true"
		>
			<div className="max-w-lg w-full mx-auto p-4 pb-8 flex flex-col gap-3">
				<div className="flex items-center gap-3 mb-4">
					{onBackToMenu ? (
						<button
							onClick={onBackToMenu}
							className="p-2 rounded-lg hover:bg-(--bg-hover)"
							aria-label="Back to menu"
						>
							<ArrowLeft size={20} style={{ color: "var(--text-primary)" }} />
						</button>
					) : (
						<Skeleton rounded="lg" className="h-9 w-9" />
					)}
					<Skeleton className="h-5 w-32" />
				</div>

				<Skeleton.Repeat count={ROWS} keyPrefix="session-order">
					{(i) => (
						<Skeleton.Card rounded="xl" className="w-full flex items-center gap-3 p-4">
							<Skeleton rounded="full" className="w-10 h-10 shrink-0" />
							<div className="flex-1 space-y-2">
								<div className="flex items-center justify-between gap-2">
									<Skeleton className="h-4" style={{ width: `${50 + (i % 3) * 12}%` }} />
									<Skeleton className="h-4 w-16" />
								</div>
								<div className="flex items-center justify-between gap-2">
									<Skeleton className="h-3 w-20" />
									<Skeleton className="h-3 w-16" />
								</div>
							</div>
						</Skeleton.Card>
					)}
				</Skeleton.Repeat>
			</div>
		</div>
	);
}
