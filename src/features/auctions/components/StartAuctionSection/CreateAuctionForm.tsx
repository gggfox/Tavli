import { UserInputValidationError } from "@/global";
import { AlertCircle, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import type { AuctionId } from "convex/constants";
import type { CreateAuctionInput } from "../../AuctionsSchemas";

interface CreateAuctionFormProps {
	onCreate: (input: CreateAuctionInput) => Promise<AuctionId | UserInputValidationError>;
	onCancel: () => void;
}

export function CreateAuctionForm({
	onCreate,
	onCancel,
}: Readonly<CreateAuctionFormProps>) {
	const [title, setTitle] = useState("");
	const [startDate, setStartDate] = useState("");
	const [endDate, setEndDate] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Set default dates (start: now, end: 1 hour from now)
	const now = new Date();
	const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

	const formatDateTimeLocal = (date: Date) => {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		const hours = String(date.getHours()).padStart(2, "0");
		const minutes = String(date.getMinutes()).padStart(2, "0");
		return `${year}-${month}-${day}T${hours}:${minutes}`;
	};

	const [defaultStartDate] = useState(formatDateTimeLocal(now));
	const [defaultEndDate] = useState(formatDateTimeLocal(oneHourLater));

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setIsCreating(true);

		try {
			const startTimestamp = new Date(startDate || defaultStartDate).getTime();
			const endTimestamp = new Date(endDate || defaultEndDate).getTime();

			if (endTimestamp <= startTimestamp) {
				throw new Error("End date must be after start date");
			}

			await onCreate({
				title: title.trim() || undefined,
				startDate: startTimestamp,
				endDate: endTimestamp,
			});

			// Reset form
			setTitle("");
			setStartDate("");
			setEndDate("");
		} catch (err) {
			if (err instanceof Error) {
				setError(err.message);
			} else if (err && typeof err === "object" && "message" in err) {
				setError(String((err as { message: unknown }).message));
			} else {
				setError("Failed to create auction");
			}
		} finally {
			setIsCreating(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<div>
				<label
					htmlFor="auction-title"
					className="block text-sm font-medium mb-1"
					style={{ color: "var(--text-primary)" }}
				>
					Title (optional)
				</label>
				<input
					id="auction-title"
					type="text"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					className="w-full px-3 py-2 rounded-md border text-sm"
					style={{
						backgroundColor: "var(--bg-primary)",
						borderColor: "var(--border-default)",
						color: "var(--text-primary)",
					}}
					placeholder="Auction title"
				/>
			</div>

			<div className="grid grid-cols-2 gap-4">
				<div>
					<label
						htmlFor="auction-start-date"
						className="block text-sm font-medium mb-1"
						style={{ color: "var(--text-primary)" }}
					>
						Start Date & Time
					</label>
					<input
						id="auction-start-date"
						type="datetime-local"
						value={startDate || defaultStartDate}
						onChange={(e) => setStartDate(e.target.value)}
						className="w-full px-3 py-2 rounded-md border text-sm"
						style={{
							backgroundColor: "var(--bg-primary)",
							borderColor: "var(--border-default)",
							color: "var(--text-primary)",
						}}
						required
					/>
				</div>
				<div>
					<label
						htmlFor="auction-end-date"
						className="block text-sm font-medium mb-1"
						style={{ color: "var(--text-primary)" }}
					>
						End Date & Time
					</label>
					<input
						id="auction-end-date"
						type="datetime-local"
						value={endDate || defaultEndDate}
						onChange={(e) => setEndDate(e.target.value)}
						className="w-full px-3 py-2 rounded-md border text-sm"
						style={{
							backgroundColor: "var(--bg-primary)",
							borderColor: "var(--border-default)",
							color: "var(--text-primary)",
						}}
						required
					/>
				</div>
			</div>

			{error && (
				<div
					className="p-2 rounded-md text-sm flex items-center gap-2"
					style={{ color: "rgb(239, 68, 68)" }}
				>
					<AlertCircle size={14} />
					{error}
				</div>
			)}

			<div className="flex items-center gap-2 justify-end">
				<button
					type="button"
					onClick={onCancel}
					className="px-4 py-2 rounded-md text-sm transition-colors"
					style={{
						backgroundColor: "var(--bg-secondary)",
						color: "var(--text-secondary)",
					}}
				>
					Cancel
				</button>
				<button
					type="submit"
					disabled={isCreating}
					className="px-4 py-2 rounded-md text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
					style={{
						backgroundColor: "rgb(59, 130, 246)",
						color: "white",
					}}
				>
					{isCreating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
					<span>{isCreating ? "Creating..." : "Create Auction"}</span>
				</button>
			</div>
		</form>
	);
}


