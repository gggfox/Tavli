/**
 * StatusFilterChips — shared, tone-driven status filter strip.
 *
 * Renders a horizontal row of pill-shaped, multi-select toggle buttons that
 * share a unified visual language across dashboards (orders, reservations,
 * etc.). Each chip is bound to a semantic tone (info / warning / success /
 * danger / neutral) instead of a hand-picked color, so the same status
 * appears identical wherever it is rendered.
 *
 * Visual model:
 *   - Inactive: subtle tinted background + tinted text, no border.
 *   - Active:   solid tone fill + contrasting foreground.
 */
import type { CSSProperties } from "react";
import { getStatusToneStyle, type StatusTone } from "./statusPalette";

export interface StatusFilterOption<T extends string> {
	readonly value: T;
	readonly label: string;
	readonly tone: StatusTone;
}

export interface StatusFilterChipsProps<T extends string> {
	readonly options: ReadonlyArray<StatusFilterOption<T>>;
	readonly selected: ReadonlySet<T>;
	readonly onToggle: (value: T) => void;
	readonly ariaLabel: string;
	readonly className?: string;
}

const CHIP_BASE_CLASSES =
	"inline-flex items-center px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1";

export function StatusFilterChips<T extends string>({
	options,
	selected,
	onToggle,
	ariaLabel,
	className = "",
}: StatusFilterChipsProps<T>) {
	return (
		<fieldset
			className={["flex flex-wrap gap-2 m-0 p-0 border-0", className]
				.filter(Boolean)
				.join(" ")}
		>
			<legend className="sr-only">{ariaLabel}</legend>
			{options.map((option) => {
				const isActive = selected.has(option.value);
				const palette = getStatusToneStyle(option.tone);

				const style: CSSProperties = isActive
					? {
							backgroundColor: palette.solidBg,
							color: palette.solidFg,
						}
					: {
							backgroundColor: palette.tintedBg,
							color: palette.fg,
						};

				return (
					<button
						key={option.value}
						type="button"
						aria-pressed={isActive}
						onClick={() => onToggle(option.value)}
						className={CHIP_BASE_CLASSES}
						style={style}
					>
						{option.label}
					</button>
				);
			})}
		</fieldset>
	);
}
