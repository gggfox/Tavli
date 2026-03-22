import { AlertCircle, CheckCircle2, Loader2, Play } from "lucide-react";
import { useState } from "react";
import type { AuctionId } from "convex/constants";

interface StartAuctionButtonProps {
	auctionId: AuctionId;
	onStart: () => Promise<void>;
}

export function StartAuctionButton({ onStart }: Readonly<StartAuctionButtonProps>) {
	const [isStarting, setIsStarting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	const handleStart = async () => {
		setIsStarting(true);
		setError(null);
		setSuccess(false);
		try {
			await onStart();
			setSuccess(true);
			// Clear success message after 2 seconds
			setTimeout(() => setSuccess(false), 2000);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to start auction");
		} finally {
			setIsStarting(false);
		}
	};

	return (
		<div className="flex items-center gap-2">
			{error && (
				<span className="text-xs flex items-center gap-1" style={{ color: "rgb(239, 68, 68)" }}>
					<AlertCircle size={12} />
					{error}
				</span>
			)}
			{success && (
				<span className="text-xs flex items-center gap-1" style={{ color: "rgb(34, 197, 94)" }}>
					<CheckCircle2 size={12} />
					Started!
				</span>
			)}
			<button
				onClick={handleStart}
				disabled={isStarting || success}
				className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-80"
				style={{
					backgroundColor: success ? "rgb(34, 197, 94)" : "rgb(59, 130, 246)",
					color: "white",
				}}
			>
				{isStarting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
				<span>{success ? "Started" : "Start Auction"}</span>
			</button>
		</div>
	);
}


