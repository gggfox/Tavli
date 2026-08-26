/**
 * Per-order tip arithmetic (TAVLI-99, ADR 008 amendment).
 *
 * Zero imports, because the number has to be identical in three places: the
 * slider that shows the diner what they are about to pay, the action that
 * builds the PaymentIntent, and the row that records what was charged. Two
 * implementations of "10%" is how a diner is shown $10.00 and charged $10.05.
 *
 * ## The tip is a percentage of the **subtotal**
 *
 * Not of the total. 10% of a $100 subtotal is $10; 10% of the $112 the diner
 * actually pays is $11.20 — which quietly tips on Tavli's service fee. The
 * restaurant did not earn that and the diner did not intend it.
 *
 * ## The service fee does not apply to the tip
 *
 * This is not a new rule. The `payments` schema already states it: *"tip
 * payments carry feeAmount 0 — the service fee never applies to tips."* Moving
 * the tip onto the order's own PaymentIntent must preserve it, which means the
 * intent's `amount` rises by the tip while `application_fee_amount` does not.
 * 100% of a tip reaches the restaurant through the destination charge, exactly
 * as it did when tips were their own charge at close-out.
 */

/** Slider bounds. 0 is a real, reachable choice — see `TIP_MIN_PERCENT`. */
export const TIP_MIN_PERCENT = 0;
export const TIP_MAX_PERCENT = 25;

/** Whole percentage points. 26 stops is comfortable for a thumb. */
export const TIP_STEP_PERCENT = 1;

export interface OrderChargeBreakdown {
	/** The order's own total, before anything is added. */
	subtotalAmount: number;
	/** Customer-borne platform fee. Computed on the subtotal alone. */
	feeAmount: number;
	/** The tip. Computed on the subtotal alone. Zero is normal. */
	gratuityAmount: number;
	/** What the diner's card is charged. */
	amount: number;
}

/**
 * Split one order's charge into its parts.
 *
 * `feeRate` is passed in rather than imported so this module stays
 * dependency-free; callers hand it `PLATFORM_APPLICATION_FEE_RATE`.
 *
 * Rounding is half-up on each component independently, and the total is their
 * sum — never a rounded percentage of a rounded total, which can disagree with
 * the parts by a cent and leave a receipt whose lines do not add up.
 */
export function computeOrderCharge(
	subtotalAmount: number,
	feeRate: number,
	tipPercent: number
): OrderChargeBreakdown {
	const feeAmount = Math.round(subtotalAmount * feeRate);
	const gratuityAmount = computeTipAmount(subtotalAmount, tipPercent);
	return {
		subtotalAmount,
		feeAmount,
		gratuityAmount,
		amount: subtotalAmount + feeAmount + gratuityAmount,
	};
}

/**
 * The tip in cents for a percentage of the subtotal.
 *
 * Clamps rather than throws. This value arrives from a slider, and a diner
 * whose input is somehow out of range should be charged a sane amount, not
 * shown a payment error they cannot act on.
 */
export function computeTipAmount(subtotalAmount: number, tipPercent: number): number {
	const clamped = clampTipPercent(tipPercent);
	return Math.round((subtotalAmount * clamped) / 100);
}

/** Force a percentage into range, treating anything unusable as no tip. */
export function clampTipPercent(tipPercent: number): number {
	if (!Number.isFinite(tipPercent)) return TIP_MIN_PERCENT;
	const rounded = Math.round(tipPercent);
	if (rounded < TIP_MIN_PERCENT) return TIP_MIN_PERCENT;
	if (rounded > TIP_MAX_PERCENT) return TIP_MAX_PERCENT;
	return rounded;
}

/** Emoji tiers for the slider's feedback. */
export type TipMood = "neutral" | "happy" | "party";

/**
 * The face shown beside the slider.
 *
 * **Neutral at zero, not sad.** A frowning face aimed at the diner who chose
 * not to tip is a nudge pointed at the one person it cannot fairly be pointed
 * at — they may be paying cash to the server, or simply not tipping — and it
 * is the kind of thing that gets screenshotted. The 🙂/🥳 end does the
 * encouraging work on its own.
 */
export function tipMood(tipPercent: number): TipMood {
	const clamped = clampTipPercent(tipPercent);
	if (clamped >= 15) return "party";
	if (clamped >= 10) return "happy";
	return "neutral";
}
