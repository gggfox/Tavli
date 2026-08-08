/**
 * SegmentedControl — single-select, contained tab-bar style.
 *
 * Renders a row of mutually exclusive segments inside a single rounded
 * container. Visually mirrors `LanguageTabBar` but is generic and exposes
 * an ARIA radiogroup with roving tabindex + arrow-key navigation, which
 * is the recommended pattern for filter-style segmented controls.
 *
 * Used by the Payments and Reservations dashboards for time-range filters.
 */
import { KEY } from "@/global/utils/keyboard";
import type { LucideIcon } from "lucide-react";
import { type CSSProperties, type KeyboardEvent, useCallback, useRef } from "react";
import { getStatusToneStyle, type StatusTone } from "../StatusFilterChips/statusPalette";

export interface SegmentedControlOption<T extends string> {
	readonly value: T;
	readonly label: string;
	readonly icon?: LucideIcon;
	/**
	 * Optional semantic tone (shared with `StatusFilterChips`). When set, the
	 * active segment fills with the tone's solid color and the inactive
	 * segment's text takes the tone's foreground, so status-shaped segments
	 * read the same as status chips elsewhere. When omitted the control keeps
	 * its neutral primary-button styling.
	 */
	readonly tone?: StatusTone;
}

export interface SegmentedControlProps<T extends string> {
	readonly options: ReadonlyArray<SegmentedControlOption<T>>;
	readonly value: T;
	readonly onChange: (value: T) => void;
	readonly ariaLabel: string;
	readonly size?: "sm" | "md";
	readonly fullWidth?: boolean;
	readonly className?: string;
	/** When true, only icons render; each option must include `icon`. Labels are used for `aria-label` / `title`. */
	readonly iconOnly?: boolean;
}

/** Per-size padding + text + fixed-height classes. The fixed `h-*` ensures icon-only buttons render at the same height as text buttons of the same size (otherwise the smaller icon would shrink the box). */
const SIZE_CLASSES = {
	sm: "px-2.5 py-1 text-xs h-6",
	md: "px-3 py-1.5 text-sm h-8",
} as const;

export function SegmentedControl<T extends string>({
	options,
	value,
	onChange,
	ariaLabel,
	size = "md",
	fullWidth = false,
	className = "",
	iconOnly = false,
}: SegmentedControlProps<T>) {
	const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

	const focusAndSelect = useCallback(
		(nextIndex: number) => {
			const next = options[nextIndex];
			if (!next) return;
			onChange(next.value);
			buttonRefs.current[nextIndex]?.focus();
		},
		[options, onChange]
	);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLButtonElement>, index: number) => {
			const last = options.length - 1;
			if (last < 0) return;

			if (event.key === KEY.ArrowRight || event.key === KEY.ArrowDown) {
				event.preventDefault();
				focusAndSelect(index === last ? 0 : index + 1);
				return;
			}
			if (event.key === KEY.ArrowLeft || event.key === KEY.ArrowUp) {
				event.preventDefault();
				focusAndSelect(index === 0 ? last : index - 1);
				return;
			}
			if (event.key === KEY.Home) {
				event.preventDefault();
				focusAndSelect(0);
				return;
			}
			if (event.key === KEY.End) {
				event.preventDefault();
				focusAndSelect(last);
			}
		},
		[options.length, focusAndSelect]
	);

	const containerStyle: CSSProperties = {
		backgroundColor: "var(--bg-secondary)",
		border: "1px solid var(--border-default)",
	};

	return (
		<div
			role="radiogroup"
			aria-label={ariaLabel}
			className={[
				"inline-flex flex-wrap gap-1 p-1 rounded-lg",
				fullWidth ? "w-full" : "w-fit",
				className,
			]
				.filter(Boolean)
				.join(" ")}
			style={containerStyle}
		>
			{options.map((opt, index) => {
				const isActive = opt.value === value;
				const Icon = opt.icon;
				const palette = opt.tone ? getStatusToneStyle(opt.tone) : null;
				const segmentStyle: CSSProperties = isActive
					? {
							backgroundColor: palette?.solidBg ?? "var(--btn-primary-bg)",
							color: palette?.solidFg ?? "var(--btn-primary-text)",
						}
					: {
							backgroundColor: "transparent",
							color: palette?.fg ?? "var(--text-secondary)",
						};
				return (
					<button
						key={opt.value}
						ref={(node) => {
							buttonRefs.current[index] = node;
						}}
						type="button"
						role="radio"
						aria-checked={isActive}
						aria-label={iconOnly ? opt.label : undefined}
						title={iconOnly ? opt.label : undefined}
						tabIndex={isActive ? 0 : -1}
						onClick={() => onChange(opt.value)}
						onKeyDown={(event) => handleKeyDown(event, index)}
						className={[
							"rounded-md font-medium transition-colors inline-flex items-center justify-center gap-1.5",
							SIZE_CLASSES[size],
							fullWidth ? "flex-1" : "",
							iconOnly ? "min-w-9 px-2" : "",
						]
							.filter(Boolean)
							.join(" ")}
						style={segmentStyle}
					>
						{Icon ? <Icon size={iconOnly ? 16 : 14} className="shrink-0" aria-hidden /> : null}
						{!iconOnly ? opt.label : null}
					</button>
				);
			})}
		</div>
	);
}
