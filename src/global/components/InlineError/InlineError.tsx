import { AlertCircle, X } from "lucide-react";

interface InlineErrorProps {
	readonly message: string;
	readonly onDismiss?: () => void;
	readonly className?: string;
}

export function InlineError({ message, onDismiss, className = "" }: InlineErrorProps) {
	return (
		<div
			className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${className}`}
			style={{
				backgroundColor: "var(--bg-danger, #2d1215)",
				border: "1px solid var(--accent-danger, #e53e3e)",
				color: "var(--accent-danger, #e53e3e)",
			}}
		>
			<AlertCircle size={16} className="shrink-0" />
			<span className="flex-1">{message}</span>
			{onDismiss && (
				<button onClick={onDismiss} className="p-0.5 rounded hover:opacity-80" title="Dismiss">
					<X size={14} />
				</button>
			)}
		</div>
	);
}
