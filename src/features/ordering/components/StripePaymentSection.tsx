/**
 * Shared Stripe Elements scaffolding for diner-facing payment sheets.
 *
 * Extracted from `OrderCheckoutPage` (TAVLI-71 Phase 3A) so the substitution
 * delta fallback (`SubstitutionPrompt`) mounts the exact same theme-aware
 * PaymentElement instead of copy-pasting the Elements wiring. Success is
 * always observed by the caller through its own Convex subscription — the
 * webhook settles the money — so this component only surfaces synchronous
 * confirmation errors.
 */
import { OrderingKeys } from "@/global/i18n";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { CreditCard, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBrandColor } from "../hooks/useBranding";
import { buildStripeAppearance } from "../stripeAppearanceTokens";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

export function useIsDarkTheme(): boolean {
	const [isDark, setIsDark] = useState(() => {
		if (typeof document === "undefined") return false;
		return document.documentElement.classList.contains("dark");
	});

	useEffect(() => {
		if (typeof document === "undefined") return;
		const root = document.documentElement;
		const update = () => {
			setIsDark(root.classList.contains("dark"));
		};
		update();
		const observer = new MutationObserver(update);
		observer.observe(root, { attributes: true, attributeFilter: ["class"] });
		return () => {
			observer.disconnect();
		};
	}, []);

	return isDark;
}

interface StripePaymentSectionProps {
	readonly clientSecret: string;
	/** Submit-button label; defaults to the checkout's "Pay Now". */
	readonly submitLabel?: string;
}

/** Theme- and brand-aware Elements wrapper around {@link StripePaymentForm}. */
export function StripePaymentSection({ clientSecret, submitLabel }: StripePaymentSectionProps) {
	const isDark = useIsDarkTheme();
	const brandColor = useBrandColor();
	// Was two module-level constants. It has to be a memo now because the
	// appearance depends on the restaurant, which a module constant computed
	// once at import time cannot know.
	const elementsOptions = useMemo(
		() => ({ clientSecret, appearance: buildStripeAppearance(brandColor, isDark) }),
		[clientSecret, isDark, brandColor]
	);

	return (
		// The key includes the brand colour because Elements reads `appearance`
		// once at mount and ignores later changes — without it a colour change
		// would leave a stale form on screen.
		//
		// Remounting Elements mid-payment would be a serious bug (it discards
		// entered card details), and this is only safe because the brand colour
		// comes from the route loader: it is fixed for the life of the page, so
		// this key cannot change while a diner is typing. Do not extend it to
		// anything that can change during a session.
		<Elements
			key={`${isDark ? "dark" : "light"}:${brandColor ?? "platform"}`}
			stripe={stripePromise}
			options={elementsOptions}
		>
			<StripePaymentForm submitLabel={submitLabel} />
		</Elements>
	);
}

function StripePaymentForm({ submitLabel }: Readonly<{ submitLabel?: string }>) {
	const { t } = useTranslation();
	const stripe = useStripe();
	const elements = useElements();
	const [processing, setProcessing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// The caller's subscription owns success (the webhook settles the money and
	// the page re-renders) and webhook-reported failures; this form only
	// surfaces synchronous confirmation errors.
	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!stripe || !elements) return;

		setProcessing(true);
		setError(null);

		const { error: submitError } = await elements.submit();
		if (submitError) {
			setError(submitError.message ?? t(OrderingKeys.CHECKOUT_GENERIC_ERROR));
			setProcessing(false);
			return;
		}

		const { error: confirmError } = await stripe.confirmPayment({
			elements,
			confirmParams: {
				return_url: globalThis.location.href,
			},
			redirect: "if_required",
		});

		if (confirmError) {
			setError(confirmError.message ?? t(OrderingKeys.CHECKOUT_GENERIC_ERROR));
			setProcessing(false);
		}
		// On success the webhook settles the payment; the caller's subscription
		// moves the UI forward.
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<PaymentElement />

			{error && (
				<div className="px-4 py-3 rounded-lg text-sm text-destructive bg-destructive-subtle">
					{error}
				</div>
			)}

			<button
				type="submit"
				disabled={!stripe || processing}
				className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold hover-btn-primary disabled:opacity-50"
			>
				{processing ? (
					<>
						<Loader2 size={16} className="animate-spin" />
						{t(OrderingKeys.CHECKOUT_PROCESSING)}
					</>
				) : (
					<>
						<CreditCard size={16} />
						{submitLabel ?? t(OrderingKeys.CHECKOUT_PAY_NOW)}
					</>
				)}
			</button>
		</form>
	);
}
