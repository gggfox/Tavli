import { Info } from "lucide-react";
import { Tooltip } from "../Tooltip";

export interface InfoTooltipProps {
	readonly description: string;
	readonly size?: number;
}

/**
 * Tooltip-wrapped info "i" icon used next to form labels and section
 * titles to surface contextual help text without taking up layout
 * space.
 */
export function InfoTooltip({ description, size = 14 }: InfoTooltipProps) {
	return (
		<Tooltip content={description} placement="top">
			<button
				type="button"
				aria-label="More info"
				className="inline-flex items-center justify-center rounded-full"
				style={{ color: "var(--text-muted)" }}
			>
				<Info size={size} />
			</button>
		</Tooltip>
	);
}
