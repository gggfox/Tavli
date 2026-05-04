/**
 * Single shift chip rendered inside a `ScheduleWeekGrid` cell or the list view.
 *
 * Visual encoding:
 *   - Background + foreground driven by `shift.shiftRole` via `shiftRoleChipStyle`.
 *   - Dashed-border + reduced opacity for SCHEDULED (drafts not yet published).
 *   - Repeating-arrow ↻ glyph for shifts materialized from a `shiftTemplates` row.
 */
import { AdminStaffKeys } from "@/global/i18n";
import { SHIFT_STATUS } from "convex/constants";
import { Repeat } from "lucide-react";
import { useTranslation } from "react-i18next";
import { utcMsToHmInTimezone } from "../timezone";
import { shiftRoleChipStyle, shiftRoleLabel } from "../roles";
import type { ScheduledShiftView } from "../types";

interface ShiftCellChipProps {
	readonly shift: ScheduledShiftView;
	readonly timezone: string;
	readonly onClick?: () => void;
	readonly compact?: boolean;
}

export function ShiftCellChip({
	shift,
	timezone,
	onClick,
	compact = false,
}: Readonly<ShiftCellChipProps>) {
	const { t } = useTranslation();
	const palette = shiftRoleChipStyle(shift.shiftRole);
	const isDraft = shift.status === SHIFT_STATUS.SCHEDULED;
	const startHm = utcMsToHmInTimezone(shift.startsAt, timezone);
	const endHm = utcMsToHmInTimezone(shift.endsAt, timezone);
	const role = shift.shiftRole ? shiftRoleLabel(shift.shiftRole, t) : null;

	const roleSuffix = role ? ` · ${role}` : "";
	const ariaLabel = `${startHm}–${endHm}${roleSuffix}`;

	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={ariaLabel}
			className={[
				"w-full text-left rounded-md px-2 py-1.5 transition-colors border",
				palette.bg,
				palette.fg,
				palette.border,
				isDraft ? "border-dashed opacity-80 hover:opacity-100" : "hover:brightness-110",
				"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
			].join(" ")}
		>
			<div className="flex items-center justify-between gap-1 text-[11px] font-medium leading-tight">
				<span className="font-mono">
					{startHm}
					<span className="opacity-60">–</span>
					{endHm}
				</span>
				<span className="flex items-center gap-1 shrink-0">
					{shift.templateId ? (
						<Repeat
							size={11}
							aria-label={t(AdminStaffKeys.SCHEDULE_GRID_TEMPLATE_BADGE)}
							className="opacity-80"
						/>
					) : null}
					{isDraft ? (
						<span className="uppercase tracking-wide text-[9px] opacity-80">
							{t(AdminStaffKeys.SCHEDULE_GRID_DRAFT_BADGE)}
						</span>
					) : null}
				</span>
			</div>
			{!compact && role ? (
				<div className="text-[10px] mt-0.5 opacity-90 truncate">{role}</div>
			) : null}
			{!compact && shift.notes ? (
				<div className="text-[10px] mt-0.5 opacity-70 truncate">{shift.notes}</div>
			) : null}
		</button>
	);
}
