import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";

type ClearDataButtonProps = Readonly<{
	onClear: () => Promise<void>;
	isClearing: boolean;
	disabled?: boolean;
}>;

export function ClearDataButton({ onClear, isClearing, disabled = false }: ClearDataButtonProps) {
	const [showConfirmClear, setShowConfirmClear] = useState(false);

	const handleClear = async () => {
		await onClear();
		setShowConfirmClear(false);
	};

	if (!showConfirmClear) {
		return (
			<button
				onClick={() => setShowConfirmClear(true)}
				disabled={disabled || isClearing}
				className="flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
				style={{
					backgroundColor: "var(--bg-tertiary)",
					color: "rgb(239, 68, 68)",
					border: "1px solid rgb(239, 68, 68)",
				}}
			>
				<Trash2 size={16} />
				<span>Clear Data</span>
			</button>
		);
	}

	return (
		<div className="flex items-center gap-2">
			<span className="text-xs" style={{ color: "rgb(239, 68, 68)" }}>
				Are you sure?
			</span>
			<button
				onClick={handleClear}
				disabled={isClearing}
				className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
				style={{
					backgroundColor: "rgb(239, 68, 68)",
					color: "white",
				}}
			>
				{isClearing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
				<span>Confirm</span>
			</button>
			<button
				onClick={() => setShowConfirmClear(false)}
				className="px-3 py-1.5 rounded-md text-sm"
				style={{
					backgroundColor: "var(--bg-tertiary)",
					color: "var(--text-secondary)",
				}}
			>
				Cancel
			</button>
		</div>
	);
}
