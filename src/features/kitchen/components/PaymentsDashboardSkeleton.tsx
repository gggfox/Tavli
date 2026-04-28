import { Skeleton } from "@/global/components";

const SUMMARY_CARDS = 3;
const TABLE_ROWS = 6;

export function PaymentsDashboardSkeleton() {
	return (
		<div className="space-y-6" aria-label="Loading payments" aria-busy="true">
			<Skeleton rounded="lg" className="h-10 w-full max-w-md" />

			<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
				{Array.from({ length: SUMMARY_CARDS }, (_, i) => (
					<div
						key={`summary-${i}`}
						className="rounded-xl p-4 flex items-center gap-4"
						style={{
							border: "1px solid var(--border-default)",
							backgroundColor: "var(--bg-secondary)",
						}}
					>
						<Skeleton rounded="lg" className="w-10 h-10 shrink-0" />
						<div className="flex-1 space-y-2">
							<Skeleton className="h-3 w-20" />
							<Skeleton className="h-6 w-24" />
						</div>
					</div>
				))}
			</div>

			<div
				className="rounded-xl overflow-hidden"
				style={{
					border: "1px solid var(--border-default)",
					backgroundColor: "var(--bg-secondary)",
				}}
			>
				<div
					className="grid grid-cols-[1fr_1fr_1fr_2fr_1fr] gap-4 px-4 py-3"
					style={{ borderBottom: "1px solid var(--border-default)" }}
				>
					<Skeleton className="h-3 w-16" />
					<Skeleton className="h-3 w-12" />
					<Skeleton className="h-3 w-12" />
					<Skeleton className="h-3 w-16" />
					<Skeleton className="h-3 w-12 ml-auto" />
				</div>
				{Array.from({ length: TABLE_ROWS }, (_, rowIndex) => (
					<div
						key={`row-${rowIndex}`}
						className="grid grid-cols-[1fr_1fr_1fr_2fr_1fr] gap-4 px-4 py-3"
						style={{
							borderBottom:
								rowIndex < TABLE_ROWS - 1 ? "1px solid var(--border-default)" : undefined,
						}}
					>
						<Skeleton className="h-4 w-24" />
						<Skeleton className="h-4" style={{ width: `${60 + (rowIndex % 3) * 12}%` }} />
						<Skeleton className="h-4 w-16" />
						<Skeleton className="h-4" style={{ width: `${50 + (rowIndex % 4) * 14}%` }} />
						<Skeleton className="h-4 w-16 ml-auto" />
					</div>
				))}
			</div>
		</div>
	);
}
