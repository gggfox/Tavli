import { getAuctionStatusConfig } from "@/features/auctions/constants/auctionStatusConfig";
import { StatusBadge } from "@/global";
import type { AuctionDoc, AuctionId } from "convex/constants";
import { StartAuctionButton } from "./StartAuctionButton";
import { formatDateShort } from "./utils";

export function ScheduledAuctionsSection({
	scheduledAuctions,
	onStartAuction,
}: Readonly<{
	scheduledAuctions: AuctionDoc[];
	onStartAuction: (auctionId: AuctionId) => Promise<void>;
}>) {
	if (scheduledAuctions.length === 0) {
		return null;
	}

	return (
		<div
			className="mb-4 p-4 rounded-lg"
			style={{
				backgroundColor: "var(--bg-secondary)",
				border: "1px solid var(--border-default)",
			}}
		>
			<h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
				Scheduled Auctions (Ready to Start)
			</h3>
			<div className="space-y-2">
				{scheduledAuctions.map((auction) => (
					<div
						key={auction._id}
						className="flex items-center justify-between p-3 rounded-md"
						style={{
							backgroundColor: "var(--bg-primary)",
							border: "1px solid var(--border-default)",
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
								Start: {formatDateShort(auction.startDate)} • End:{" "}
								{formatDateShort(auction.endDate)}
							</div>
						</div>
						<StartAuctionButton onStart={() => onStartAuction(auction._id)} />
					</div>
				))}
			</div>
		</div>
	);
}
