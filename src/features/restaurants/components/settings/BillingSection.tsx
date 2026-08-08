import { RestaurantsKeys } from "@/global/i18n";
import { formatCents, unwrapResult } from "@/global/utils";
import { getErrorMessage } from "@/global/utils/errorMessages";
import { useConvexAction, useConvexMutation } from "@convex-dev/react-query";
import { api } from "convex/_generated/api";
import type { Doc } from "convex/_generated/dataModel";
import {
	BILLING_STATUS,
	isLiveBillingStatus,
	PLATFORM_MONTHLY_FEE_MXN_CENTS,
	PLATFORM_SUBSCRIPTION_CURRENCY,
} from "convex/constants";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface BillingSectionProps {
	readonly restaurant: Doc<"restaurants">;
	/** Platform admins may arm/disarm the subscription; everyone else reads it. */
	readonly isAdmin: boolean;
}

/** Stripe's status → our copy. Unknown statuses fall back rather than leak the raw string. */
const STATUS_KEYS: Record<string, string> = {
	[BILLING_STATUS.ACTIVE]: RestaurantsKeys.BILLING_STATUS_ACTIVE,
	[BILLING_STATUS.TRIALING]: RestaurantsKeys.BILLING_STATUS_TRIALING,
	[BILLING_STATUS.PAST_DUE]: RestaurantsKeys.BILLING_STATUS_PAST_DUE,
	[BILLING_STATUS.UNPAID]: RestaurantsKeys.BILLING_STATUS_UNPAID,
	[BILLING_STATUS.INCOMPLETE]: RestaurantsKeys.BILLING_STATUS_INCOMPLETE,
	[BILLING_STATUS.INCOMPLETE_EXPIRED]: RestaurantsKeys.BILLING_STATUS_CANCELED,
	[BILLING_STATUS.PAUSED]: RestaurantsKeys.BILLING_STATUS_PAUSED,
	[BILLING_STATUS.CANCELED]: RestaurantsKeys.BILLING_STATUS_CANCELED,
};

/**
 * The 2,000 MXN/month platform subscription the RESTAURANT pays Tavli
 * (ADR 008 / TAVLI-71 Phase 4B), rendered inside the Payments section.
 *
 * Not the diner-paid Tavli service fee: that one is 12% per order, charged at
 * the diner's checkout, and never shows up here. The copy says so out loud
 * because the two are easy to confuse in a settings screen that also hosts
 * Stripe Connect.
 *
 * The displayed amount comes from `PLATFORM_MONTHLY_FEE_MXN_CENTS` and is
 * DISPLAY ONLY — the Stripe Price behind `STRIPE_PLATFORM_FEE_PRICE_ID` is what
 * actually gets charged.
 */
export function BillingSection({ restaurant, isAdmin }: Readonly<BillingSectionProps>) {
	const { t } = useTranslation();
	const setEnabled = useConvexMutation(api.billingHelpers.setPlatformSubscriptionEnabled);
	const createCheckout = useConvexAction(api.billing.createSubscriptionCheckout);
	const cancelSubscription = useConvexAction(api.billing.cancelSubscription);

	const [togglePending, setTogglePending] = useState(false);
	const [checkoutPending, setCheckoutPending] = useState(false);
	const [cancelPending, setCancelPending] = useState(false);
	const [confirmingCancel, setConfirmingCancel] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	// Returning from Stripe-hosted Checkout: `?billing=success|cancelled` is
	// stamped by `billing.createSubscriptionCheckout`. It is deliberately
	// OUT-OF-BAND — not a key in the route's `validateRestaurantsSearch`, which
	// owns only `manage`/`settings` (the two canvases). It exists solely on the
	// hard document load Stripe redirects us into, is consumed once on mount, and
	// is stripped from the URL immediately so a refresh or a back-navigation does
	// not resurrect a stale notice. Any in-app `navigate()` legitimately drops it
	// for the same reason. Read straight off `location` exactly how
	// `StripeConnectSetup` handles `?stripe_return`.
	useEffect(() => {
		const params = new URLSearchParams(globalThis.location.search);
		const outcome = params.get("billing");
		if (outcome !== "success" && outcome !== "cancelled") return;

		setNotice(
			outcome === "success"
				? t(RestaurantsKeys.BILLING_RETURN_SUCCESS)
				: t(RestaurantsKeys.BILLING_RETURN_CANCELLED)
		);
		const url = new URL(globalThis.location.href);
		url.searchParams.delete("billing");
		globalThis.history.replaceState({}, "", url.toString());
	}, [t]);

	const enabled = restaurant.platformSubscriptionEnabled === true;
	const status = restaurant.billingStatus;
	const hasLiveSubscription =
		Boolean(restaurant.stripeSubscriptionId) && isLiveBillingStatus(status);
	const cancelScheduled = restaurant.billingCancelAtPeriodEnd === true;
	const periodEnd = restaurant.billingCurrentPeriodEnd;

	const handleToggle = async (next: boolean) => {
		setError(null);
		setNotice(null);
		setTogglePending(true);
		try {
			unwrapResult(await setEnabled({ restaurantId: restaurant._id, enabled: next }));
		} catch (err) {
			setError(getErrorMessage(err, t, RestaurantsKeys.BILLING_TOGGLE_FAILED));
		} finally {
			setTogglePending(false);
		}
	};

	const handleCheckout = async () => {
		setError(null);
		setNotice(null);
		setCheckoutPending(true);
		try {
			const { url } = await createCheckout({ restaurantId: restaurant._id });
			globalThis.location.href = url;
		} catch (err) {
			setError(getErrorMessage(err, t, RestaurantsKeys.BILLING_CHECKOUT_FAILED));
			setCheckoutPending(false);
		}
	};

	const handleCancel = async () => {
		setError(null);
		setNotice(null);
		setCancelPending(true);
		try {
			await cancelSubscription({ restaurantId: restaurant._id });
			setConfirmingCancel(false);
		} catch (err) {
			setError(getErrorMessage(err, t, RestaurantsKeys.BILLING_CANCEL_FAILED));
		} finally {
			setCancelPending(false);
		}
	};

	const statusKey = status
		? (STATUS_KEYS[status] ?? RestaurantsKeys.BILLING_STATUS_UNKNOWN)
		: RestaurantsKeys.BILLING_STATUS_NONE;

	const formattedDate = (ms: number) =>
		new Date(ms).toLocaleDateString(undefined, {
			year: "numeric",
			month: "long",
			day: "numeric",
		});

	return (
		<div
			data-testid="settings-billing"
			className="rounded-xl p-6 space-y-4 bg-muted border border-border"
		>
			<div>
				<h3 className="text-sm font-semibold text-foreground">
					{t(RestaurantsKeys.BILLING_HEADING)}
				</h3>
				<p className="text-xs mt-0.5 text-faint-foreground">
					{t(RestaurantsKeys.BILLING_DESCRIPTION)}
				</p>
			</div>

			{error ? (
				<div
					className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-destructive"
					style={{ backgroundColor: "rgba(220, 38, 38, 0.1)" }}
				>
					<AlertCircle size={14} />
					{error}
				</div>
			) : null}

			{notice ? (
				<div
					className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs text-success"
					style={{ backgroundColor: "rgba(34, 197, 94, 0.1)" }}
				>
					<CheckCircle2 size={14} className="mt-0.5 shrink-0" />
					<span>{notice}</span>
				</div>
			) : null}

			<div className="flex items-start gap-3">
				<input
					id="platform-subscription-enabled"
					type="checkbox"
					checked={enabled}
					disabled={!isAdmin || togglePending}
					onChange={(e) => handleToggle(e.target.checked)}
					data-testid="settings-billing-toggle"
					className="mt-1 h-4 w-4 rounded border-border disabled:opacity-50 disabled:cursor-not-allowed"
				/>
				<div className="min-w-0">
					<label
						htmlFor="platform-subscription-enabled"
						className="block text-sm font-medium text-foreground"
					>
						{t(RestaurantsKeys.BILLING_ENABLE_LABEL)}
					</label>
					<p className="text-xs text-faint-foreground">
						{t(isAdmin ? RestaurantsKeys.BILLING_ENABLE_HINT : RestaurantsKeys.BILLING_ADMIN_ONLY)}
					</p>
				</div>
			</div>

			{enabled ? (
				<div className="space-y-3 border-t border-border pt-4">
					<dl className="space-y-1.5 text-sm">
						<div className="flex items-center justify-between gap-3">
							<dt className="text-faint-foreground">{t(RestaurantsKeys.BILLING_PLAN_LABEL)}</dt>
							<dd className="font-medium text-foreground" data-testid="settings-billing-amount">
								{t(RestaurantsKeys.BILLING_PLAN_VALUE, {
									amount: formatCents(PLATFORM_MONTHLY_FEE_MXN_CENTS),
									currency: PLATFORM_SUBSCRIPTION_CURRENCY,
								})}
							</dd>
						</div>
						<div className="flex items-center justify-between gap-3">
							<dt className="text-faint-foreground">{t(RestaurantsKeys.BILLING_STATUS_LABEL)}</dt>
							<dd className="font-medium text-foreground" data-testid="settings-billing-status">
								{t(statusKey)}
							</dd>
						</div>
						{periodEnd ? (
							<div className="flex items-center justify-between gap-3">
								<dt className="text-faint-foreground">
									{t(
										cancelScheduled
											? RestaurantsKeys.BILLING_ENDS_LABEL
											: RestaurantsKeys.BILLING_RENEWS_LABEL
									)}
								</dt>
								<dd className="font-medium text-foreground">{formattedDate(periodEnd)}</dd>
							</div>
						) : null}
					</dl>

					{cancelScheduled && periodEnd ? (
						<p
							className="text-xs text-faint-foreground"
							data-testid="settings-billing-cancel-notice"
						>
							{t(RestaurantsKeys.BILLING_CANCEL_SCHEDULED, { date: formattedDate(periodEnd) })}
						</p>
					) : null}

					{status === BILLING_STATUS.PAST_DUE || status === BILLING_STATUS.UNPAID ? (
						<p className="text-xs text-faint-foreground">
							{t(RestaurantsKeys.BILLING_PAST_DUE_HINT)}
						</p>
					) : null}

					{/*
					 * Checkout starts a subscription, so it is offered only when there
					 * isn't one. Changing the card on a live (or past_due) subscription
					 * needs a Stripe Billing Portal session, not a second Checkout —
					 * TODO(TAVLI-71): add `billing.createBillingPortalSession` and an
					 * "Update payment method" button here.
					 */}
					<div className="flex flex-wrap items-center gap-3">
						{hasLiveSubscription ? null : (
							<button
								type="button"
								onClick={handleCheckout}
								disabled={checkoutPending}
								data-testid="settings-billing-checkout"
								className="px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
							>
								{checkoutPending ? (
									<span className="flex items-center gap-2">
										<Loader2 size={14} className="animate-spin" />
										{t(RestaurantsKeys.BILLING_SETUP_REDIRECTING)}
									</span>
								) : (
									t(RestaurantsKeys.BILLING_SETUP_BUTTON)
								)}
							</button>
						)}

						{/*
						 * Deliberately an INLINE confirm rather than the `Modal` idiom
						 * `ReservationCancelConfirmDialog` uses. The two destructive
						 * actions differ in kind: cancelling a reservation is taken from a
						 * timeline where the row would vanish under the operator, so it
						 * needs a focus trap. This one already lives inside a full-canvas
						 * settings page the admin navigated to on purpose, it is
						 * reversible (cancel-at-period-end, undoable until the period
						 * ends), and stacking a dialog over a canvas that Phase 4A just
						 * un-modal-ed would undo that change locally.
						 */}
						{hasLiveSubscription && !cancelScheduled ? (
							confirmingCancel ? (
								<div className="space-y-2">
									<p className="text-xs text-faint-foreground max-w-md">
										{t(RestaurantsKeys.BILLING_CANCEL_CONFIRM)}
									</p>
									<div className="flex items-center gap-2">
										<button
											type="button"
											onClick={handleCancel}
											disabled={cancelPending}
											data-testid="settings-billing-cancel-confirm"
											className="px-3 py-1.5 rounded-lg text-xs font-medium text-destructive border border-border disabled:opacity-50"
										>
											{cancelPending
												? t(RestaurantsKeys.BILLING_CANCELLING)
												: t(RestaurantsKeys.BILLING_CANCEL_CONFIRM_YES)}
										</button>
										<button
											type="button"
											onClick={() => setConfirmingCancel(false)}
											disabled={cancelPending}
											className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-hover"
										>
											{t(RestaurantsKeys.BILLING_CANCEL_CONFIRM_NO)}
										</button>
									</div>
								</div>
							) : (
								<button
									type="button"
									onClick={() => setConfirmingCancel(true)}
									data-testid="settings-billing-cancel"
									className="px-4 py-2 rounded-lg text-sm text-muted-foreground border border-border hover:bg-hover"
								>
									{t(RestaurantsKeys.BILLING_CANCEL_BUTTON)}
								</button>
							)
						) : null}
					</div>
				</div>
			) : (
				<p className="text-xs text-faint-foreground border-t border-border pt-4">
					{t(RestaurantsKeys.BILLING_DISABLED_STATE)}
				</p>
			)}

			<p className="text-xs text-faint-foreground border-t border-border pt-3">
				{t(RestaurantsKeys.BILLING_DISTINCT_NOTE)}
			</p>
		</div>
	);
}
