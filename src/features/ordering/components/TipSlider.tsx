/**
 * Per-order tip control (TAVLI-99).
 *
 * Collapsed by default: the total line reads `Tip (10%) $10.00` with a Change
 * button, and the slider expands underneath it. The payment page should stay
 * about paying — a diner who does not care about the tip sees a pre-applied
 * 10% in the total and never has to touch this.
 *
 * ## The emoji is not the feedback, it accompanies it
 *
 * `aria-valuetext` carries "15% — $15.00", so the control is fully legible to
 * a screen reader and to anyone whose font stack renders 🥳 as a box. A slider
 * whose only feedback is a picture communicates nothing to either.
 *
 * ## Zero is reachable, and the face there is neutral
 *
 * A pre-applied tip with no visible way to remove it is the pattern that
 * generates chargebacks from diners who did not notice. The slider bottoms out
 * at 0 in one drag. The face at 0 is 😐, not 😞: a frowning face aimed at
 * someone who chose not to tip is a nudge pointed at the one person it cannot
 * fairly be pointed at — they may be tipping the server in cash — and it is
 * the sort of thing that gets screenshotted.
 */
import { OrderingKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import {
	TIP_MAX_PERCENT,
	TIP_MIN_PERCENT,
	TIP_STEP_PERCENT,
	computeTipAmount,
	tipMood,
} from "convex/_shared/tip";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

const MOOD_EMOJI = { neutral: "😐", happy: "🙂", party: "🥳" } as const;

interface TipSliderProps {
	/** The order subtotal the percentage applies to. Never the total. */
	readonly subtotalAmount: number;
	readonly tipPercent: number;
	readonly onChange: (tipPercent: number) => void;
	/** Locked while a payment sheet is mounted — see the note in the checkout. */
	readonly disabled?: boolean;
}

export function TipSlider({
	subtotalAmount,
	tipPercent,
	onChange,
	disabled = false,
}: Readonly<TipSliderProps>) {
	const { t } = useTranslation();
	const [expanded, setExpanded] = useState(false);
	const sliderId = useId();

	const tipAmount = computeTipAmount(subtotalAmount, tipPercent);
	const mood = tipMood(tipPercent);
	const valueText = `${tipPercent}% — $${formatCents(tipAmount)}`;

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between gap-2 text-sm">
				<span className="text-muted-foreground">
					{t(OrderingKeys.CHECKOUT_TIP_LABEL, { percent: tipPercent })}
				</span>
				<div className="flex items-center gap-2">
					<span className="text-muted-foreground tabular-nums">${formatCents(tipAmount)}</span>
					<button
						type="button"
						onClick={() => setExpanded((previous) => !previous)}
						aria-expanded={expanded}
						aria-controls={sliderId}
						className="text-xs font-medium underline text-muted-foreground disabled:opacity-50"
						disabled={disabled}
					>
						{t(OrderingKeys.CHECKOUT_TIP_CHANGE)}
					</button>
				</div>
			</div>

			{expanded ? (
				<div id={sliderId} className="flex items-center gap-3 rounded-lg bg-muted px-3 py-2.5">
					<input
						type="range"
						min={TIP_MIN_PERCENT}
						max={TIP_MAX_PERCENT}
						step={TIP_STEP_PERCENT}
						value={tipPercent}
						disabled={disabled}
						onChange={(e) => onChange(Number(e.target.value))}
						aria-label={t(OrderingKeys.CHECKOUT_TIP_SLIDER_ARIA)}
						// The percentage alone would announce as a bare number. The
						// dollar figure is the thing a diner is deciding about.
						aria-valuetext={valueText}
						className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-(--bg-active) accent-(--btn-primary-bg)"
					/>
					<span
						className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums text-foreground"
						// The live value is already announced by the slider itself;
						// repeating it here would double every drag.
						aria-hidden
					>
						{tipPercent}%
					</span>
					<span className="text-lg leading-none" aria-hidden>
						{MOOD_EMOJI[mood]}
					</span>
				</div>
			) : null}
		</div>
	);
}
