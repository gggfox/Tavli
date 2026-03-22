import { formatDateShort } from "./utils";
import { TimeRemaining } from "./TimeRemaining";
import type { AuctionId } from "convex/constants";

export function AuctionHeader({
	auction,
}: Readonly<{
	auction: {
		_id: AuctionId;
		title?: string;
		startDate: number;
		endDate: number;
	};
}>) {
	return (
		<div
			className="mb-4 p-4 rounded-lg flex items-center justify-between"
			style={{
				backgroundColor: "rgba(34, 197, 94, 0.1)",
				border: "1px solid rgba(34, 197, 94, 0.3)",
			}}
		>
			<div className="flex items-center gap-3">
				<div
					className="w-3 h-3 rounded-full animate-pulse"
					style={{ backgroundColor: "rgb(34, 197, 94)" }}
				/>
				<div>
					<h3 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
						{auction.title || "Current Live Auction"}
					</h3>
					<p className="text-xs" style={{ color: "var(--text-secondary)" }}>
						Started {formatDateShort(auction.startDate)}
					</p>
				</div>
			</div>
			<div className="flex items-center gap-4">
				<div className="text-right">
					<p className="text-xs" style={{ color: "var(--text-secondary)" }}>
						Auction Ends
					</p>
					<p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
						{formatDateShort(auction.endDate)}
					</p>
				</div>
				<div className="h-8 w-px" style={{ backgroundColor: "rgba(34, 197, 94, 0.3)" }} />
				<div className="text-right">
					<p className="text-xs" style={{ color: "var(--text-secondary)" }}>
						Time Remaining
					</p>
					<TimeRemaining endDate={auction.endDate} />
				</div>
			</div>
		</div>
	);
}


