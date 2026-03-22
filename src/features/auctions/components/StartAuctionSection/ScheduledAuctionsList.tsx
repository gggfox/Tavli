import { getAuctionStatusConfig } from "@/features/auctions/constants/auctionStatusConfig";
import { StatusBadge } from "@/global";
import type { AuctionId } from "convex/constants";
import type { Auction } from "../../hooks/useAuctions";
import { formatDateShort } from "./formatDateShort";
import { StartAuctionButton } from "./StartAuctionButton";

interface ScheduledAuctionsListProps {
	scheduledAuctions: Auction[];
	onStartAuction: (auctionId: AuctionId) => Promise<void>;
}

export function ScheduledAuctionsList({
	scheduledAuctions,
	onStartAuction,
}: Readonly<ScheduledAuctionsListProps>) {
	if (scheduledAuctions.length === 0) {
		return (
			<div
				className="p-4 rounded-lg border text-center"
				style={{
					backgroundColor: "var(--bg-secondary)",
					borderColor: "var(--border-default)",
				}}
			>
				<span className="text-sm" style={{ color: "var(--text-secondary)" }}>
					No scheduled auctions available to start
				</span>
			</div>
		);
	}

	return (
		<div className="space-y-2">
			{scheduledAuctions.map((auction) => (
				<div
					key={auction._id}
					className="flex items-center justify-between p-3 rounded-md border"
					style={{
						backgroundColor: "var(--bg-primary)",
						borderColor: "var(--border-default)",
					}}
				>
					<div className="flex-1">
						<div className="flex items-center gap-2 mb-1">
							<span className="font-medium" style={{ color: "var(--text-primary)" }}>
								{auction.title || "Untitled Auction"}
							</span>
							{(() => {
								const config = getAuctionStatusConfig(auction.status);
								return (
									<StatusBadge
										bgColor={config.bgColor}
										textColor={config.textColor}
										label={auction.status}
									/>
								);
							})()}
						</div>
						<div className="text-xs" style={{ color: "var(--text-secondary)" }}>
							Start: {formatDateShort(auction.startDate)} • End: {formatDateShort(auction.endDate)}
						</div>
					</div>
					<StartAuctionButton auctionId={auction._id} onStart={() => onStartAuction(auction._id)} />
				</div>
			))}
		</div>
	);
}

