import { getAuctionStatusConfig } from "@/features/auctions/constants/auctionStatusConfig";
import { StatusBadge } from "@/global";
import type { AuctionId } from "convex/constants";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { useState } from "react";
import type { Auction } from "../../hooks/useAuctions";
import { EndAuctionConfirmationModal } from "./EndAuctionConfirmationModal";
import { formatDateShort } from "./formatDateShort";

interface LiveAuctionStatusProps {
	liveAuction: Auction | null;
	onEndAuction: (auctionId: AuctionId) => Promise<void>;
}

export function LiveAuctionStatus({ liveAuction, onEndAuction }: Readonly<LiveAuctionStatusProps>) {
	const [showConfirmModal, setShowConfirmModal] = useState(false);
	const [isEnding, setIsEnding] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (!liveAuction) {
		return (
			<div
				className="p-4 rounded-lg border"
				style={{
					backgroundColor: "var(--bg-secondary)",
					borderColor: "var(--border-default)",
				}}
			>
				<div className="flex items-center gap-2">
					<AlertCircle size={16} style={{ color: "var(--text-secondary)" }} />
					<span className="text-sm" style={{ color: "var(--text-secondary)" }}>
						No live auction currently active
					</span>
				</div>
			</div>
		);
	}

	const handleEndAuction = async () => {
		setIsEnding(true);
		setError(null);
		try {
			await onEndAuction(liveAuction._id);
			setShowConfirmModal(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to end auction");
		} finally {
			setIsEnding(false);
		}
	};

	return (
		<>
			<div
				className="p-4 rounded-lg border"
				style={{
					backgroundColor: "rgba(34, 197, 94, 0.1)",
					borderColor: "rgb(34, 197, 94)",
				}}
			>
				<div className="flex items-start justify-between">
					<div className="flex-1">
						<div className="flex items-center gap-2 mb-2">
							<CheckCircle2 size={16} style={{ color: "rgb(34, 197, 94)" }} />
							<span className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
								Live Auction Active
							</span>
							{(() => {
								const config = getAuctionStatusConfig(liveAuction.status);
								return (
									<StatusBadge
										bgColor={config.bgColor}
										textColor={config.textColor}
										label={liveAuction.status}
									/>
								);
							})()}
						</div>
						<div className="text-sm mb-1" style={{ color: "var(--text-primary)" }}>
							{liveAuction.title || "Untitled Auction"}
						</div>
						<div className="text-xs" style={{ color: "var(--text-secondary)" }}>
							Start: {formatDateShort(liveAuction.startDate)} • End:{" "}
							{formatDateShort(liveAuction.endDate)}
						</div>
						{error && (
							<div
								className="mt-2 text-xs flex items-center gap-1"
								style={{ color: "rgb(239, 68, 68)" }}
							>
								<AlertCircle size={12} />
								{error}
							</div>
						)}
					</div>
					<button
						onClick={() => setShowConfirmModal(true)}
						disabled={isEnding}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-80"
						style={{
							backgroundColor: "rgb(239, 68, 68)",
							color: "white",
						}}
					>
						<X size={14} />
						<span>End Auction</span>
					</button>
				</div>
			</div>

			<EndAuctionConfirmationModal
				isOpen={showConfirmModal}
				onClose={() => {
					if (!isEnding) {
						setShowConfirmModal(false);
						setError(null);
					}
				}}
				onConfirm={handleEndAuction}
				auctionTitle={liveAuction.title || "Untitled Auction"}
				isEnding={isEnding}
			/>
		</>
	);
}
