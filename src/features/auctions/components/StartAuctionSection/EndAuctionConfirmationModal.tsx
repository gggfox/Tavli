import { Modal } from "@/global";
import { AlertCircle, Loader2, X } from "lucide-react";

interface EndAuctionConfirmationModalProps {
	isOpen: boolean;
	onClose: () => void;
	onConfirm: () => Promise<void>;
	auctionTitle: string;
	isEnding: boolean;
}

export function EndAuctionConfirmationModal({
	isOpen,
	onClose,
	onConfirm,
	auctionTitle,
	isEnding,
}: Readonly<EndAuctionConfirmationModalProps>) {
	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			ariaLabel="End Auction Confirmation"
			size="md"
			closeOnBackdropClick={!isEnding}
			closeOnEscape={!isEnding}
		>
			<div
				className="p-6 rounded-lg border"
				style={{
					backgroundColor: "var(--bg-primary)",
					borderColor: "var(--border-default)",
				}}
			>
				<div className="flex items-center gap-3 mb-4">
					<div
						className="flex items-center justify-center w-10 h-10 rounded-full"
						style={{ backgroundColor: "rgba(239, 68, 68, 0.1)" }}
					>
						<AlertCircle size={20} style={{ color: "rgb(239, 68, 68)" }} />
					</div>
					<h3 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
						End Auction Early?
					</h3>
				</div>

				<p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
					Are you sure you want to end the auction <strong>&ldquo;{auctionTitle}&rdquo;</strong>{" "}
					early? This action cannot be undone. The auction will be closed immediately and all active
					bids will be finalized.
				</p>

				<div className="flex items-center gap-2 justify-end">
					<button
						type="button"
						onClick={onClose}
						disabled={isEnding}
						className="px-4 py-2 rounded-md text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
						style={{
							backgroundColor: "var(--bg-secondary)",
							color: "var(--text-secondary)",
						}}
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={onConfirm}
						disabled={isEnding}
						className="px-4 py-2 rounded-md text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
						style={{
							backgroundColor: "rgb(239, 68, 68)",
							color: "white",
						}}
					>
						{isEnding ? (
							<>
								<Loader2 size={14} className="animate-spin" />
								<span>Ending...</span>
							</>
						) : (
							<>
								<X size={14} />
								<span>End Auction</span>
							</>
						)}
					</button>
				</div>
			</div>
		</Modal>
	);
}
