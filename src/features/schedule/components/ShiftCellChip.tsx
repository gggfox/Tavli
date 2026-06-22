/**
 * Single shift chip rendered inside a `ScheduleWeekGrid` cell or the list view.
 *
 * Visual encoding:
 *   - Background + foreground driven by `shift.shiftRole` via `shiftRoleChipStyle`.
 *   - `absenceState="pending"` overrides the role palette with a yellow alert
 *     palette so a manager can spot at a glance that this shift overlaps a
 *     pending day-off request that needs a decision.
 *   - `absenceState="approved"` mutes the chip and strikes through the time
 *     range so the manager knows the assignment now sits on a confirmed
 *     off-day and likely needs reassignment.
 *   - Dashed-border + reduced opacity for SCHEDULED (drafts not yet published).
 *   - Repeating-arrow ↻ glyph for shifts materialized from a `shiftTemplates` row.
 *
 * Tablet (≤1024px): time range on line 1; role, notes, and badges on line 2.
 * Desktop: time + badges on line 1; role and notes on separate rows.
 */
import { AdminStaffKeys } from "@/global/i18n";
import { SHIFT_STATUS } from "convex/constants";
import { Repeat } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { utcMsToHmInTimezone } from "../timezone";
import { shiftRoleChipStyle, shiftRoleLabel } from "../roles";
import type { ScheduledShiftView } from "../types";

export type ChipAbsenceState = "pending" | "approved";

interface ShiftCellChipProps {
	readonly shift: ScheduledShiftView;
	readonly timezone: string;
	readonly onClick?: () => void;
	readonly compact?: boolean;
	readonly absenceState?: ChipAbsenceState;
}

const PENDING_PALETTE = {
	bg: "bg-yellow-400/25",
	fg: "text-yellow-900 dark:text-yellow-100",
	border: "border-yellow-500/70",
} as const;

const APPROVED_PALETTE = {
	bg: "bg-muted/60",
	fg: "text-faint-foreground",
	border: "border-border",
} as const;

function paletteFor(
	absenceState: ChipAbsenceState | undefined,
	rolePalette: ReturnType<typeof shiftRoleChipStyle>
) {
	if (absenceState === "pending") return PENDING_PALETTE;
	if (absenceState === "approved") return APPROVED_PALETTE;
	return rolePalette;
}

function absenceSuffixKey(absenceState: ChipAbsenceState | undefined): string | null {
	if (absenceState === "pending") return AdminStaffKeys.SCHEDULE_CHIP_PENDING_SUFFIX;
	if (absenceState === "approved") return AdminStaffKeys.SCHEDULE_CHIP_APPROVED_SUFFIX;
	return null;
}

function tabletMetaText(role: string | null, notes: string | undefined): string {
	const parts = [role, notes?.trim()].filter(Boolean);
	return parts.join(" · ");
}

interface ChipBadgesProps {
	readonly shift: ScheduledShiftView;
	readonly isDraft: boolean;
	readonly t: TFunction;
}

function ChipBadges({ shift, isDraft, t }: Readonly<ChipBadgesProps>) {
	return (
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
	);
}

export function ShiftCellChip({
	shift,
	timezone,
	onClick,
	compact = false,
	absenceState,
}: Readonly<ShiftCellChipProps>) {
	const { t } = useTranslation();
	const palette = paletteFor(absenceState, shiftRoleChipStyle(shift.shiftRole));
	const isDraft = shift.status === SHIFT_STATUS.SCHEDULED;
	const startHm = utcMsToHmInTimezone(shift.startsAt, timezone);
	const endHm = utcMsToHmInTimezone(shift.endsAt, timezone);
	const role = shift.shiftRole ? shiftRoleLabel(shift.shiftRole, t) : null;

	const roleSuffix = role ? ` · ${role}` : "";
	const suffixKey = absenceSuffixKey(absenceState);
	const absenceSuffix = suffixKey ? t(suffixKey) : "";
	const ariaLabel = `${startHm}–${endHm}${roleSuffix}${absenceSuffix}`;
	const timeStruck = absenceState === "approved";
	const tabletMeta = tabletMetaText(role, shift.notes);
	const showTabletMetaRow =
		!compact && (tabletMeta.length > 0 || shift.templateId != null || isDraft);

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
				<span className={`font-mono ${timeStruck ? "line-through" : ""}`}>
					{startHm}
					<span className="opacity-60">–</span>
					{endHm}
				</span>
				<span className="hidden lg:flex">
					<ChipBadges shift={shift} isDraft={isDraft} t={t} />
				</span>
			</div>
			{!compact && role ? (
				<div className="hidden lg:block text-[10px] mt-0.5 opacity-90 truncate">{role}</div>
			) : null}
			{!compact && shift.notes ? (
				<div className="hidden lg:block text-[10px] mt-0.5 opacity-70 truncate">{shift.notes}</div>
			) : null}
			{showTabletMetaRow ? (
				<div className="lg:hidden text-[10px] mt-0.5 flex items-center gap-1 min-w-0">
					{tabletMeta ? (
						<span className="flex-1 min-w-0 truncate opacity-90">{tabletMeta}</span>
					) : (
						<span className="flex-1 min-w-0" />
					)}
					<ChipBadges shift={shift} isDraft={isDraft} t={t} />
				</div>
			) : null}
		</button>
	);
}
