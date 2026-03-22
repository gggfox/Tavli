import { api } from "convex/_generated/api";
import type { AuctionId, MaterialDoc } from "convex/constants";
import { useConvex } from "convex/react";
import { Gavel } from "lucide-react";
import { useState } from "react";
import { formatCurrency } from "./utils";

type Material = MaterialDoc;
type HighestBid = {
	amount: number;
	bidderId: string;
	totalBids: number;
	currentSequence: number;
} | null;

export function BidButton({
	material,
	auctionId,
	highestBid,
	onBidPlaced,
}: Readonly<{
	material: Material;
	auctionId: AuctionId;
	highestBid: HighestBid;
	onBidPlaced: () => void;
}>) {
	const [isOpen, setIsOpen] = useState(false);
	const [bidAmount, setBidAmount] = useState("");
	const [error, setError] = useState<string | null>(null);
	const convex = useConvex();

	const minimumBid = highestBid ? highestBid.amount + 1 : 1;

	const handleSubmitBid = async () => {
		const amount = Number.parseFloat(bidAmount);
		if (Number.isNaN(amount) || amount < minimumBid) {
			setError(`Bid must be at least ${formatCurrency(minimumBid)}`);
			return;
		}

		setError(null);
		try {
			await convex.mutation(api.bids.placeBid, {
				auctionId,
				materialId: material._id,
				amount,
				currency: "MXN",
				expectedSequence: highestBid?.currentSequence ?? 0,
			});
			setBidAmount("");
			setIsOpen(false);
			onBidPlaced();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to place bid");
		}
	};

	if (!isOpen) {
		return (
			<button
				onClick={() => setIsOpen(true)}
				className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all hover:scale-105"
				style={{
					backgroundColor: "rgb(59, 130, 246)",
					color: "white",
				}}
			>
				<Gavel size={14} />
				<span>Bid</span>
			</button>
		);
	}

	return (
		<div className="flex items-center gap-2">
			<input
				type="number"
				value={bidAmount}
				onChange={(e) => setBidAmount(e.target.value)}
				placeholder={`Min: ${formatCurrency(minimumBid)}`}
				className="w-28 px-2 py-1 rounded text-sm"
				style={{
					backgroundColor: "var(--bg-primary)",
					color: "var(--text-primary)",
					border: "1px solid var(--border-default)",
				}}
				autoFocus
			/>
			<button
				onClick={handleSubmitBid}
				className="px-2 py-1 rounded text-sm font-medium transition-colors"
				style={{
					backgroundColor: "rgb(34, 197, 94)",
					color: "white",
				}}
			>
				Submit
			</button>
			<button
				onClick={() => {
					setIsOpen(false);
					setBidAmount("");
					setError(null);
				}}
				className="px-2 py-1 rounded text-sm transition-colors"
				style={{
					backgroundColor: "var(--bg-hover)",
					color: "var(--text-secondary)",
				}}
			>
				Cancel
			</button>
			{error && (
				<span className="text-xs" style={{ color: "rgb(239, 68, 68)" }}>
					{error}
				</span>
			)}
		</div>
	);
}
