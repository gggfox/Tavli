import { CommonKeys } from "@/global/i18n";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
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
	const { t } = useTranslation();
	return (
		<Tooltip content={description} placement="top">
			<button
				type="button"
				aria-label={t(CommonKeys.MORE_INFO)}
				className="inline-flex items-center justify-center rounded-full text-faint-foreground"
			>
				<Info size={size} />
			</button>
		</Tooltip>
	);
}
