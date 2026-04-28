import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface CopyableIdProps {
	readonly id: string;
	readonly truncateLength?: number;
	readonly className?: string;
}

const COPY_FEEDBACK_MS = 1500;
const TOOLTIP_OFFSET_PX = 8;

export function CopyableId({ id, truncateLength = 12, className = "" }: CopyableIdProps) {
	const [copied, setCopied] = useState(false);
	const [tooltipVisible, setTooltipVisible] = useState(false);
	const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
		};
	}, []);

	const handleCopy = useCallback(
		async (event: React.MouseEvent<HTMLButtonElement>) => {
			event.stopPropagation();
			try {
				await navigator.clipboard.writeText(id);
				setCopied(true);
				if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
				feedbackTimeoutRef.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
			} catch (error) {
				console.error("Failed to copy ID to clipboard", error);
			}
		},
		[id]
	);

	const positionTooltip = useCallback(() => {
		if (!buttonRef.current) return;
		const rect = buttonRef.current.getBoundingClientRect();
		setTooltipPos({
			top: rect.top - TOOLTIP_OFFSET_PX,
			left: rect.left + rect.width / 2,
		});
	}, []);

	const showTooltip = useCallback(() => {
		positionTooltip();
		setTooltipVisible(true);
	}, [positionTooltip]);

	const hideTooltip = useCallback(() => {
		setTooltipVisible(false);
	}, []);

	const truncated =
		id.length > truncateLength ? `${id.slice(0, truncateLength)}...` : id;

	const tooltipLabel = copied ? "Copied!" : id;

	return (
		<>
			<button
				ref={buttonRef}
				type="button"
				onClick={handleCopy}
				onMouseEnter={showTooltip}
				onMouseLeave={hideTooltip}
				onFocus={showTooltip}
				onBlur={hideTooltip}
				className={`group inline-flex items-center gap-1.5 font-mono text-xs rounded px-1.5 py-0.5 -mx-1.5 cursor-pointer transition-colors hover:bg-(--bg-hover) focus:outline-none focus-visible:ring-1 focus-visible:ring-(--input-border-focus) ${className}`}
				style={{ color: "var(--text-secondary)" }}
				aria-label={copied ? `ID ${id} copied to clipboard` : `Copy ID ${id}`}
			>
				<span>{truncated}</span>
				{copied ? (
					<Check size={12} style={{ color: "var(--accent-success)" }} aria-hidden />
				) : (
					<Copy
						size={12}
						className="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity"
						aria-hidden
					/>
				)}
			</button>

			{tooltipVisible && tooltipPos && typeof document !== "undefined"
				? createPortal(
						<div
							role="tooltip"
							className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md px-2 py-1 text-xs font-mono shadow-md"
							style={{
								top: tooltipPos.top,
								left: tooltipPos.left,
								backgroundColor: "var(--bg-elevated)",
								color: "var(--text-primary)",
								border: "1px solid var(--border-strong)",
							}}
						>
							{tooltipLabel}
						</div>,
						document.body
					)
				: null}
		</>
	);
}
