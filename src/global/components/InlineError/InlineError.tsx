import { AlertCircle, X } from "lucide-react";

interface InlineErrorProps {
	readonly message: string;
	readonly onDismiss?: () => void;
	readonly className?: string;
}

export function InlineError({ message, onDismiss, className = "" }: InlineErrorProps) {
	return (
		// `--bg-danger` was never declared in theme.css, so this always fell
		// through to a hard-coded dark-mode-only hex. The real token for a
		// subtle danger surface is `--accent-danger-light`, i.e.
		// `bg-destructive-subtle`.
		<div
			className={`${`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${className}`} border border-destructive text-destructive bg-destructive-subtle`}
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
