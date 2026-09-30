import { OrderingKeys } from "@/global/i18n";
import { getErrorMessage } from "@/global/utils/errorMessages";
import { useFormatMoney } from "@/global/hooks/useFormatMoney";
import { track } from "@/global/utils/telemetry";
import { convexQuery, useConvexAction, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import {
	DEFAULT_TIP_PERCENT,
	PAYMENT_STATUS,
	PLATFORM_APPLICATION_FEE_RATE,
} from "convex/constants";
import {
	ArrowLeft,
	CheckCircle2,
	ChefHat,
	CreditCard,
	HandCoins,
	Loader2,
	ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { computeOrderCharge } from "convex/_shared/tip";
import { EmailReceiptButton } from "./EmailReceiptButton";
import { TipSlider } from "./TipSlider";
import { StripePaymentSection, type ConfirmedPaymentIntent } from "./StripePaymentSection";
import {
	PAYMENT_CONFIRMATION_ESCALATE_AFTER_MS,
	forgetPaymentConfirmation,
	isConfirmedIntentStatus,
	readPaymentConfirmation,
	rememberPaymentConfirmation,
	useStoredPaymentConfirmation,
	type PaymentConfirmation,
} from "../utils/paymentConfirmation";

/** Customer-borne service-fee rate as a display percentage (e.g. 12). */
const SERVICE_FEE_PERCENT = PLATFORM_APPLICATION_FEE_RATE * 100;

/**
 * Payment-row statuses under which a confirmed charge is still on its way.
 * `succeeded` is included for the instant between the payment row settling
 * and the order's `paymentState` following it; `pending` is not, because a
 * pending row has no intent the diner could have confirmed.
 */
const CONFIRMING_PAYMENT_STATUSES = new Set<string>([
	PAYMENT_STATUS.PROCESSING,
	PAYMENT_STATUS.SUCCEEDED,
]);

interface OrderCheckoutPageProps {
	orderId: Id<"orders">;
	onBackToMenu: () => void;
	onViewOrders: () => void;
	/**
	 * Stripe's `payment_intent` / `redirect_status` query params when the diner
	 * lands here back from a redirect-based 3-D Secure challenge.
	 */
	stripeRedirect?: { paymentIntentId: string; status: string };
}

/**
 * Per-order pay-at-submit checkout (ADR 008): the diner pays
 * `subtotal + {@link PLATFORM_APPLICATION_FEE_RATE} service fee` for one draft
 * order before the kitchen sees it, or commits it for in-person (cash)
 * payment (`awaiting_payment`).
 *
 * The tip lives here as of TAVLI-99, pre-applied at
 * {@link DEFAULT_TIP_PERCENT} and adjustable through {@link TipSlider}. That
 * reverses ADR 008 Phase 3B, which put the tip after the visit: diners were
 * not reaching close-out, so they were not tipping. The cost taken knowingly
 * is that tipping now happens before the food arrives, which is when people
 * tip less.
 *
 * The **cash path shows no tip control at all** — the diner tips the server in
 * cash at the table, and charging a card for an order that is not being paid
 * by card is a different transaction with different consent.
 *
 * Success is detected by subscription: the Stripe webhook flips the order's
 * `paymentState` to "paid", which this page observes through
 * `orders.getOrderWithItems`.
 *
 * Between the diner confirming and that webhook, the page shows
 * {@link PaymentConfirmingScreen} and no pay button — across a reload and a
 * 3-D Secure redirect too. The backend's `processing` alone cannot drive that
 * (a row is `processing` from the moment its intent exists, before any card is
 * typed), so the confirmation itself is remembered client-side; see
 * `utils/paymentConfirmation.ts`.
 */
export function OrderCheckoutPage({
	orderId,
	onBackToMenu,
	onViewOrders,
	stripeRedirect,
}: Readonly<OrderCheckoutPageProps>) {
	const formatMoney = useFormatMoney();
	const { t } = useTranslation();
	const createPaymentIntent = useConvexAction(api.stripe.createPaymentIntent);
	const cancelPaymentIntent = useConvexAction(api.stripe.cancelOrderPaymentIntent);
	const requestPayInPerson = useMutation({
		mutationFn: useConvexMutation(api.orders.requestPayInPerson),
	});

	const [clientSecret, setClientSecret] = useState<string | null>(null);
	// Pre-applied, which is the point: a diner who does not care about the tip
	// sees it in the total and never opens the slider.
	const [tipPercent, setTipPercent] = useState<number>(DEFAULT_TIP_PERCENT);
	const [initializing, setInitializing] = useState(false);
	const [cashSubmitting, setCashSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Set the moment `confirmPayment` succeeds in this page. The stored copy
	// below is what survives a reload; this one covers a browser whose storage
	// is unavailable.
	const [inPageConfirmation, setInPageConfirmation] = useState<PaymentConfirmation | null>(null);
	const storedConfirmation = useStoredPaymentConfirmation(orderId);

	const { data: order, isError } = useQuery({
		...convexQuery(api.orders.getOrderWithItems, { orderId }),
		// A rejected id fails identically on every retry; see OrderStatus.
		retry: false,
	});

	// A webhook-reported decline surfaces through the subscription; drop the
	// Elements form so the next attempt creates a fresh intent.
	useEffect(() => {
		if (order?.paymentState === "failed") {
			setClientSecret(null);
			setInPageConfirmation(null);
			forgetPaymentConfirmation(orderId);
			setError(order.activePayment?.failureMessage ?? t(OrderingKeys.CHECKOUT_PAYMENT_FAILED));
		}
	}, [order?.paymentState, order?.activePayment?.failureMessage, orderId, t]);

	// Settled: the confirmation has done its job.
	useEffect(() => {
		if (order?.paymentState === "paid") forgetPaymentConfirmation(orderId);
	}, [order?.paymentState, orderId]);

	// Back from a redirect-based 3-D Secure challenge. Stripe's
	// `redirect_status` says whether the diner got through; it only counts for
	// the intent this order still points at, so a stale URL from an earlier
	// attempt changes nothing.
	const redirectForActiveIntent =
		stripeRedirect !== undefined &&
		order?.stripePaymentIntentId !== undefined &&
		order.stripePaymentIntentId === stripeRedirect.paymentIntentId
			? stripeRedirect
			: undefined;
	const redirectConfirmed =
		redirectForActiveIntent !== undefined &&
		isConfirmedIntentStatus(redirectForActiveIntent.status);
	const redirectFailed = redirectForActiveIntent !== undefined && !redirectConfirmed;

	// Persist a successful redirect like an in-page confirmation, so a reload
	// (which keeps the query string, but not forever) keeps the diner on the
	// confirming screen with the escalation clock where it was.
	useEffect(() => {
		if (!redirectConfirmed || !stripeRedirect) return;
		if (readPaymentConfirmation(orderId)?.paymentIntentId === stripeRedirect.paymentIntentId) {
			return;
		}
		rememberPaymentConfirmation(orderId, {
			paymentIntentId: stripeRedirect.paymentIntentId,
			confirmedAt: Date.now(),
		});
	}, [redirectConfirmed, stripeRedirect, orderId]);

	const confirmation = inPageConfirmation ?? storedConfirmation;
	const confirmedIntentId =
		confirmation?.paymentIntentId ?? (redirectConfirmed ? stripeRedirect?.paymentIntentId : null);

	const handleConfirmed = (paymentIntent: ConfirmedPaymentIntent) => {
		const confirmed = { paymentIntentId: paymentIntent.id, confirmedAt: Date.now() };
		setInPageConfirmation(confirmed);
		rememberPaymentConfirmation(orderId, confirmed);
		// The confirming screen replaces the sheet. If the webhook later reports
		// a decline, the failure effect above brings the diner back to a fresh
		// "Continue to payment".
		setClientSecret(null);
	};

	// `order_placed` is the settled moment, not the tap. An order leaves "draft"
	// exactly once — into "awaiting_payment" on a cash commitment, or paid by the
	// webhook on a card — so that transition is the event. A page that mounts
	// already placed (a reload of the receipt) has no previous state and stays
	// silent, and a later cash→card switch is a payment, not a second placement.
	const orderStatus = order?.status;
	const paymentState = order?.paymentState;
	const previousStatus = useRef<string | undefined>(undefined);
	const reportedPlaced = useRef(false);
	useEffect(() => {
		const previous = previousStatus.current;
		previousStatus.current = orderStatus;
		if (previous !== "draft" || reportedPlaced.current) return;
		const method =
			orderStatus === "awaiting_payment" ? "cash" : paymentState === "paid" ? "card" : null;
		if (method === null) return;
		reportedPlaced.current = true;
		track("order_placed", { order_id: orderId, payment_method: method });
	}, [orderStatus, paymentState, orderId]);

	const handleStartPayment = async () => {
		setInitializing(true);
		setError(null);
		// A new attempt: whatever an earlier one confirmed no longer describes it.
		setInPageConfirmation(null);
		forgetPaymentConfirmation(orderId);
		try {
			const result = await createPaymentIntent({ orderId, tipPercent });
			setClientSecret(result?.clientSecret ?? null);
			track("checkout_started", { order_id: orderId, tip_percent: tipPercent });
		} catch (err) {
			setError(getErrorMessage(err, t, OrderingKeys.CHECKOUT_INIT_FAILED));
			setClientSecret(null);
		} finally {
			setInitializing(false);
		}
	};

	/**
	 * Is there a card intent live at Stripe for this order right now?
	 *
	 * `clientSecret` covers the sheet mounted in this page; the payment row's
	 * status covers an intent prepared before a reload. Read at click time, not
	 * memoized, because both inputs change while the diner is deciding.
	 */
	const hasPreparedCharge = () =>
		clientSecret !== null ||
		order?.activePayment?.status === "pending" ||
		order?.activePayment?.status === "processing";

	/**
	 * Leaving the checkout stands the prepared charge down at Stripe before
	 * navigating (TAVLI-104).
	 *
	 * Plain navigation was the bug: the intent stayed live with its client secret
	 * in a page the diner might come back to, or leave open in another tab, and
	 * confirming it later charged a card for an order that had moved on. The
	 * diner taps Pay again when they return — the page never auto-creates an
	 * intent, so there is nothing to re-arm.
	 *
	 * Non-blocking on failure: getting out of the checkout must always work. A
	 * cancel that does not reach Stripe leaves the intent for the supersede path
	 * to stand down on the next attempt, which is the same guarantee the rest of
	 * this ticket rests on.
	 */
	const handleBackToMenu = async () => {
		if (hasPreparedCharge()) {
			try {
				await cancelPaymentIntent({ orderId });
			} catch (err) {
				console.error("[OrderCheckoutPage] failed to cancel the prepared charge", err);
			}
		}
		onBackToMenu();
	};

	// While a card intent is mounted, switching to cash REQUIRES cancelling it
	// first — the backend rejects `requestPayInPerson` with
	// ERROR_ORDER_PAYMENT_IN_FLIGHT otherwise, so a stale payment sheet can
	// never double-settle a cash order.
	const handlePayInPerson = async () => {
		setCashSubmitting(true);
		setError(null);
		try {
			if (hasPreparedCharge()) {
				const { settled } = await cancelPaymentIntent({ orderId });
				if (settled) {
					// The card charge won the race and the webhook is settling the
					// order. `requestPayInPerson` would reject with
					// ERROR_ORDER_PAYMENT_IN_FLIGHT, so the diner would see an error
					// one tick before the paid screen. Yield to the subscription
					// instead: `paymentState: "paid"` swaps this page out.
					setClientSecret(null);
					return;
				}
			}
			// Already committed to cash (card-switch abandoned): dropping the
			// intent is the whole job — the order is not a draft anymore, so
			// re-requesting would be rejected.
			if (order?.status !== "awaiting_payment") {
				await requestPayInPerson.mutateAsync({ orderId });
			}
			setClientSecret(null);
		} catch (err) {
			setError(getErrorMessage(err, t, OrderingKeys.CHECKOUT_GENERIC_ERROR));
		} finally {
			setCashSubmitting(false);
		}
	};

	if (order === null || (order === undefined && isError)) {
		return <OrderCheckoutFallback onBackToMenu={onBackToMenu} />;
	}

	if (order === undefined) {
		return (
			<div className="flex items-center justify-center h-full p-8">
				<Loader2 size={24} className="animate-spin text-faint-foreground" />
			</div>
		);
	}

	if (order.paymentState === "paid") {
		return (
			<OrderPaidScreen
				orderId={orderId}
				dailyOrderNumber={order.dailyOrderNumber ?? null}
				onBackToMenu={onBackToMenu}
				onViewOrders={onViewOrders}
			/>
		);
	}

	// The diner confirmed this order's live intent and the webhook has not
	// settled it. No pay button, no cash switch: either would be a second
	// attempt at money that may already be moving. A decline flips
	// `paymentState` to "failed" and drops back to the summary below.
	const isConfirming =
		confirmedIntentId !== null &&
		confirmedIntentId !== undefined &&
		order.stripePaymentIntentId === confirmedIntentId &&
		order.paymentState !== "failed" &&
		order.activePayment !== null &&
		CONFIRMING_PAYMENT_STATUSES.has(order.activePayment.status);

	if (isConfirming) {
		return (
			<PaymentConfirmingScreen
				orderId={orderId}
				confirmedAt={confirmation?.confirmedAt ?? null}
				onViewOrders={onViewOrders}
			/>
		);
	}

	const liveItems = order.items.filter((item) => item.cancelledAt === undefined);
	// Back from 3-D Secure without getting through. The webhook's decline
	// message (in `error`) is more specific when it has landed; until then,
	// say plainly that nothing was charged.
	const displayError =
		error ?? (redirectFailed && !clientSecret ? t(OrderingKeys.CHECKOUT_REDIRECT_FAILED) : null);
	// One shared computation with the server, so the number on screen is the
	// number charged — see `convex/_shared/tip.ts`.
	const {
		subtotalAmount: subtotal,
		feeAmount,
		amount: total,
	} = computeOrderCharge(order.totalAmount, PLATFORM_APPLICATION_FEE_RATE, tipPercent);

	// Cash commitment confirmed (and no card retry mounted): show the diner the
	// number to call out. `clientSecret` wins so a cash→card switch keeps the
	// payment sheet on screen.
	if (order.status === "awaiting_payment" && !clientSecret) {
		return (
			<PayInPersonScreen
				dailyOrderNumber={order.dailyOrderNumber ?? null}
				totalAmount={order.totalAmount}
				error={displayError}
				switching={initializing}
				onPayByCard={handleStartPayment}
				onViewOrders={onViewOrders}
			/>
		);
	}

	if (order.status !== "draft" && order.status !== "awaiting_payment") {
		return <OrderCheckoutFallback onBackToMenu={onBackToMenu} />;
	}

	return (
		<div className="flex flex-col h-full w-full overflow-y-auto">
			<div className="flex flex-col max-w-lg w-full mx-auto p-4 pb-8 space-y-6">
				<div className="flex items-center gap-3">
					<button
						onClick={handleBackToMenu}
						className="p-2 rounded-lg hover:bg-(--bg-hover) text-foreground"
						aria-label={t(OrderingKeys.BACK_TO_MENU_ARIA)}
					>
						<ArrowLeft size={20} />
					</button>
					<h2 className="text-lg font-bold text-foreground">{t(OrderingKeys.CHECKOUT_HEADING)}</h2>
				</div>

				{/* Order summary: items, subtotal, customer-borne service fee, total */}
				<div className="rounded-xl p-4 space-y-2 bg-muted border border-border">
					<h3 className="text-sm font-semibold text-foreground">
						{t(OrderingKeys.CHECKOUT_ORDER_SUMMARY)}
					</h3>
					{liveItems.map((item) => (
						<div
							key={item._id}
							className="flex justify-between gap-2 text-sm text-muted-foreground"
						>
							<span className="min-w-0 truncate">
								{item.quantity}x {item.menuItemName}
							</span>
							<span className="shrink-0">{formatMoney(item.lineTotal)}</span>
						</div>
					))}
					<div className="flex justify-between pt-2 text-sm border-t border-border text-muted-foreground">
						<span>{t(OrderingKeys.CHECKOUT_SUBTOTAL)}</span>
						<span>{formatMoney(subtotal)}</span>
					</div>
					<div className="flex justify-between text-sm text-muted-foreground">
						<span>{t(OrderingKeys.CHECKOUT_SERVICE_FEE, { rate: SERVICE_FEE_PERCENT })}</span>
						<span>{formatMoney(feeAmount)}</span>
					</div>
					{/*
					 * Locked once a payment sheet is mounted. Stripe fixes the
					 * amount when the intent is created, so a tip changed after
					 * that point would be shown but not charged — the diner would
					 * be told one number and billed another.
					 */}
					<TipSlider
						subtotalAmount={subtotal}
						tipPercent={tipPercent}
						onChange={setTipPercent}
						disabled={clientSecret !== null}
					/>
					<div className="flex justify-between pt-2 text-sm font-semibold border-t border-border text-foreground">
						<span>{t(OrderingKeys.CHECKOUT_TOTAL)}</span>
						<span>{formatMoney(total)}</span>
					</div>
				</div>

				{displayError && (
					<div className="px-4 py-3 rounded-lg text-sm text-destructive bg-destructive-subtle">
						{displayError}
					</div>
				)}

				{clientSecret ? (
					<StripePaymentSection clientSecret={clientSecret} onConfirmed={handleConfirmed} />
				) : (
					<button
						type="button"
						onClick={handleStartPayment}
						disabled={initializing || cashSubmitting}
						className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold hover-btn-primary disabled:opacity-50"
					>
						{initializing ? (
							<>
								<Loader2 size={16} className="animate-spin" />
								{t(OrderingKeys.CHECKOUT_PROCESSING)}
							</>
						) : (
							<>
								<CreditCard size={16} />
								{t(OrderingKeys.CHECKOUT_CONTINUE_TO_PAYMENT)}
							</>
						)}
					</button>
				)}

				{/* Stays visible while the card form is mounted: it cancels the card
				    intent first, then commits the order for cash. */}
				<button
					type="button"
					onClick={handlePayInPerson}
					disabled={cashSubmitting || initializing}
					className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border border-border text-foreground hover:bg-(--bg-hover) disabled:opacity-50"
				>
					{cashSubmitting ? (
						<>
							<Loader2 size={16} className="animate-spin" />
							{t(OrderingKeys.CHECKOUT_PROCESSING)}
						</>
					) : (
						<>
							<HandCoins size={16} />
							{t(OrderingKeys.CHECKOUT_PAY_IN_PERSON)}
						</>
					)}
				</button>

				<div className="flex items-center justify-center gap-2 text-xs text-faint-foreground">
					<ShieldCheck size={14} />
					<span>{t(OrderingKeys.CHECKOUT_SECURED_BY_STRIPE)}</span>
				</div>
			</div>
		</div>
	);
}

function OrderCheckoutFallback({ onBackToMenu }: Readonly<{ onBackToMenu: () => void }>) {
	const { t } = useTranslation();
	return (
		<div className="flex flex-col items-center justify-center h-full p-8 gap-3 text-center">
			<p className="text-sm text-faint-foreground max-w-sm">
				{t(OrderingKeys.CHECKOUT_ORDER_NOT_FOUND)}
			</p>
			<button
				onClick={onBackToMenu}
				className="px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
			>
				{t(OrderingKeys.BACK_TO_MENU)}
			</button>
		</div>
	);
}

/**
 * Cash commitment confirmed: the order is `awaiting_payment`, staff collect at
 * the table against the daily order number, and the kitchen fires only once
 * they mark it paid.
 */
function PayInPersonScreen({
	dailyOrderNumber,
	totalAmount,
	error,
	switching,
	onPayByCard,
	onViewOrders,
}: Readonly<{
	dailyOrderNumber: number | null;
	totalAmount: number;
	error: string | null;
	switching: boolean;
	onPayByCard: () => void;
	onViewOrders: () => void;
}>) {
	const formatMoney = useFormatMoney();
	const { t } = useTranslation();
	return (
		<div className="flex flex-col items-center justify-center h-full p-8 gap-4 text-center">
			<div className="w-16 h-16 rounded-full flex items-center justify-center bg-muted">
				<HandCoins size={32} className="text-foreground" />
			</div>
			<h2 className="text-lg font-bold text-foreground">{t(OrderingKeys.CHECKOUT_CASH_TITLE)}</h2>
			{dailyOrderNumber !== null && (
				<p className="text-4xl font-extrabold tabular-nums text-foreground">
					{t(OrderingKeys.CHECKOUT_CASH_ORDER_NUMBER, { n: dailyOrderNumber })}
				</p>
			)}
			<p className="text-2xl font-semibold text-foreground">{formatMoney(totalAmount)}</p>
			<p className="text-sm max-w-xs text-muted-foreground">
				{t(OrderingKeys.CHECKOUT_CASH_SHOW_SERVER)}
			</p>
			<p className="text-xs max-w-xs text-faint-foreground">
				{t(OrderingKeys.CHECKOUT_CASH_KITCHEN_NOTE)}
			</p>

			{error && (
				<div className="px-4 py-3 rounded-lg text-sm text-destructive bg-destructive-subtle">
					{error}
				</div>
			)}

			<button
				onClick={onViewOrders}
				className="mt-2 px-6 py-2.5 rounded-xl text-sm font-medium hover-btn-primary"
			>
				{t(OrderingKeys.CHECKOUT_VIEW_ORDERS)}
			</button>
			<button
				type="button"
				onClick={onPayByCard}
				disabled={switching}
				className="flex items-center gap-2 text-xs font-medium underline text-muted-foreground disabled:opacity-50"
			>
				{switching ? (
					<>
						<Loader2 size={12} className="animate-spin" />
						{t(OrderingKeys.CHECKOUT_PROCESSING)}
					</>
				) : (
					t(OrderingKeys.CHECKOUT_PAY_BY_CARD_INSTEAD)
				)}
			</button>
		</div>
	);
}

/**
 * The diner confirmed a card payment; the webhook has not settled it yet.
 *
 * Calm for {@link PAYMENT_CONFIRMATION_ESCALATE_AFTER_MS}, then explicit: do
 * not pay again, and show this screen to staff. The order reference is the
 * same `#` + last six characters of the id the staff Orders dashboard prints
 * on a card with no daily number yet, which an unpaid draft never has — so a
 * server can find the order from what is on the diner's phone.
 *
 * The clock runs from `confirmedAt` when it is known (it survives a reload),
 * or from mount otherwise. The subscription keeps listening throughout: a
 * late webhook, or the stuck-payment sweep minutes later, still moves the
 * parent to the paid screen.
 */
function PaymentConfirmingScreen({
	orderId,
	confirmedAt,
	onViewOrders,
}: Readonly<{
	orderId: Id<"orders">;
	confirmedAt: number | null;
	onViewOrders: () => void;
}>) {
	const { t } = useTranslation();
	const [mountedAt] = useState(() => Date.now());
	const since = confirmedAt ?? mountedAt;
	const [escalated, setEscalated] = useState(false);

	useEffect(() => {
		const remaining = since + PAYMENT_CONFIRMATION_ESCALATE_AFTER_MS - Date.now();
		const timer = setTimeout(() => setEscalated(true), Math.max(0, remaining));
		return () => clearTimeout(timer);
	}, [since]);

	return (
		<div
			role="status"
			aria-live="polite"
			className="flex flex-col items-center justify-center h-full p-8 gap-4 text-center"
		>
			<div className="w-16 h-16 rounded-full flex items-center justify-center bg-muted">
				<Loader2 size={32} className="animate-spin text-foreground" />
			</div>
			<h2 className="text-lg font-bold text-foreground">
				{escalated
					? t(OrderingKeys.CHECKOUT_CONFIRMING_SLOW_TITLE)
					: t(OrderingKeys.CHECKOUT_CONFIRMING_TITLE)}
			</h2>
			<p className="text-sm max-w-xs text-muted-foreground">
				{escalated
					? t(OrderingKeys.CHECKOUT_CONFIRMING_SLOW_DESC)
					: t(OrderingKeys.CHECKOUT_CONFIRMING_DESC)}
			</p>
			<p
				className={`tabular-nums ${escalated ? "text-base font-semibold text-foreground" : "text-xs text-faint-foreground"}`}
			>
				{t(OrderingKeys.CHECKOUT_CONFIRMING_REFERENCE, { ref: `#${orderId.slice(-6)}` })}
			</p>
			{escalated && (
				<button
					type="button"
					onClick={onViewOrders}
					className="mt-2 px-6 py-2.5 rounded-xl text-sm font-medium border border-border text-foreground hover:bg-(--bg-hover)"
				>
					{t(OrderingKeys.CHECKOUT_VIEW_ORDERS)}
				</button>
			)}
		</div>
	);
}

function OrderPaidScreen({
	orderId,
	dailyOrderNumber,
	onBackToMenu,
	onViewOrders,
}: Readonly<{
	orderId: Id<"orders">;
	dailyOrderNumber: number | null;
	onBackToMenu: () => void;
	onViewOrders: () => void;
}>) {
	const { t } = useTranslation();
	return (
		<div className="flex flex-col items-center justify-center h-full p-8 gap-4 text-center">
			<div className="w-16 h-16 rounded-full flex items-center justify-center bg-success-subtle">
				<CheckCircle2 size={32} style={{ color: "var(--accent-success)" }} />
			</div>
			<h2 className="text-lg font-bold text-foreground">{t(OrderingKeys.CHECKOUT_PAID_TITLE)}</h2>
			{dailyOrderNumber !== null && (
				<p className="text-4xl font-extrabold tabular-nums text-foreground">
					{t(OrderingKeys.CHECKOUT_CASH_ORDER_NUMBER, { n: dailyOrderNumber })}
				</p>
			)}
			<p className="text-sm max-w-xs text-muted-foreground flex items-center justify-center gap-2">
				<ChefHat size={16} className="shrink-0" />
				{dailyOrderNumber !== null
					? t(OrderingKeys.CHECKOUT_PAID_DESC, { n: dailyOrderNumber })
					: t(OrderingKeys.CHECKOUT_PAID_DESC_NO_NUMBER)}
			</p>
			<div className="w-full max-w-xs">
				<EmailReceiptButton orderId={orderId} />
			</div>
			<button
				onClick={onViewOrders}
				className="mt-2 px-6 py-2.5 rounded-xl text-sm font-medium hover-btn-primary"
			>
				{t(OrderingKeys.CHECKOUT_VIEW_ORDERS)}
			</button>
			<button
				type="button"
				onClick={onBackToMenu}
				className="text-xs font-medium underline text-muted-foreground"
			>
				{t(OrderingKeys.BACK_TO_MENU)}
			</button>
		</div>
	);
}
