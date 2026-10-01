import {
	getStatusToneStyle,
	type StatusToneStyle,
} from "@/global/components/StatusFilterChips/statusPalette";
import type { CSSProperties } from "react";

/**
 * Fill, border and text colour of a reservation block on the timeline.
 *
 * A double booking (the reservation overlaps a walk-in on its table) is the one
 * block staff must not miss, so it is drawn in the danger palette whatever its
 * status: the danger tint and a danger border, with full-contrast text rather
 * than red-on-red — white on the solid danger fill is under 4.5:1 at the
 * block's 10px size. Cancelled and no-show blocks are quiet: their status tint
 * with a neutral border (the component also fades them).
 *
 * Every value is a theme token that exists. This used to reference
 * `--destructive`, `--destructive-tinted` and `--border`, which the theme never
 * defined — the browser drops a declaration whose `var()` cannot resolve, so a
 * colliding block had no fill and a text-coloured border (only the thin ring
 * was red), and a cancelled block's border fell through to its red text colour.
 * `timelineBlockStyle.test.ts` checks every variable here against the theme.
 */
export function getTimelineBlockStyle({
	palette,
	isColliding,
	isDimmed,
}: Readonly<{
	palette: StatusToneStyle;
	isColliding: boolean;
	isDimmed: boolean;
}>): CSSProperties {
	if (isColliding) {
		const danger = getStatusToneStyle("danger");
		return {
			backgroundColor: danger.tintedBg,
			borderColor: danger.fg,
			color: "var(--color-foreground)",
		};
	}
	return {
		backgroundColor: palette.tintedBg,
		borderColor: isDimmed ? "var(--color-border)" : palette.fg,
		color: palette.fg,
	};
}
