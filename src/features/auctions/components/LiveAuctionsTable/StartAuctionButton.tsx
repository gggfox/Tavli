import { Loader2, Play } from "lucide-react";
import { useState } from "react";

export function StartAuctionButton({ onStart }: Readonly<{ onStart: () => Promise<void> }>) {
	const [isStarting, setIsStarting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleStart = async () => {
		setIsStarting(true);
		setError(null);
		try {
			await onStart();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to start auction");
		} finally {
			setIsStarting(false);
		}
	};

	return (
		<div className="flex items-center gap-2">
			{error && (
				<span className="text-xs" style={{ color: "rgb(239, 68, 68)" }}>
					{error}
				</span>
			)}
			<button
				onClick={handleStart}
				disabled={isStarting}
				className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-80"
				style={{
					backgroundColor: "rgb(34, 197, 94)",
					color: "white",
				}}
			>
				{isStarting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
				<span>Start Auction</span>
			</button>
		</div>
	);
}
