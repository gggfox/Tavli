/**
 * Shared status tone palette.
 *
 * Maps semantic tones to CSS-variable colors so that any status-shaped UI
 * (filter chips, inline badges, indicators) can reach for the same set of
 * five tones instead of hand-picking colors per feature.
 *
 * Tones are intentionally generic so the same primitive works across
 * domains (orders, reservations, payments, etc.).
 */

export type StatusTone = "info" | "warning" | "success" | "danger" | "neutral";

export interface StatusToneStyle {
	/** Saturated fill used for active/selected pills and inline badges. */
	readonly solidBg: string;
	/** Subtle tinted fill used for inactive (ghost) pills. */
	readonly tintedBg: string;
	/** Foreground color used on top of `tintedBg`. */
	readonly fg: string;
	/** Foreground color used on top of `solidBg`. */
	readonly solidFg: string;
}

export const STATUS_TONE_PALETTE: Record<StatusTone, StatusToneStyle> = {
	info: {
		solidBg: "var(--accent-info)",
		tintedBg: "var(--accent-info-light)",
		fg: "var(--accent-info)",
		solidFg: "#ffffff",
	},
	warning: {
		solidBg: "var(--accent-warning)",
		tintedBg: "var(--accent-warning-light)",
		fg: "var(--accent-warning)",
		solidFg: "#ffffff",
	},
	success: {
		solidBg: "var(--accent-success)",
		tintedBg: "var(--accent-success-light)",
		fg: "var(--accent-success)",
		solidFg: "#ffffff",
	},
	danger: {
		solidBg: "var(--accent-danger)",
		tintedBg: "var(--accent-danger-light)",
		fg: "var(--accent-danger)",
		solidFg: "#ffffff",
	},
	neutral: {
		solidBg: "var(--text-secondary)",
		tintedBg: "var(--accent-neutral-light)",
		fg: "var(--text-secondary)",
		solidFg: "var(--bg-primary)",
	},
};

export function getStatusToneStyle(tone: StatusTone): StatusToneStyle {
	return STATUS_TONE_PALETTE[tone];
}

/**
 * Look up the tone for a given value in a chip array. Lets dashboards
 * declare their `(value, label, tone)` triples once (typically as
 * `STATUS_CHIPS` for `<StatusFilterChips>`) and then reach for the same
 * tone elsewhere (row pills, badges, indicators) without maintaining
 * a parallel `Record<value, tone>` map by hand.
 */
export function toneByValue<T extends string>(
	chips: ReadonlyArray<{ readonly value: T; readonly tone: StatusTone }>,
	value: T
): StatusTone | undefined {
	return chips.find((chip) => chip.value === value)?.tone;
}
