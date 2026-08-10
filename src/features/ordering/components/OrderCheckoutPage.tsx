import { OrderingKeys } from "@/global/i18n";
import { getErrorMessage } from "@/global/utils/errorMessages";
import { formatCents } from "@/global/utils/money";
import { convexQuery, useConvexAction, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { PLATFORM_APPLICATION_FEE_RATE } from "convex/constants";
import {
	ArrowLeft,
	CheckCircle2,
	ChefHat,
	CreditCard,
	HandCoins,
	Loader2,
	ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmailReceiptButton } from "./EmailReceiptButton";
import { StripePaymentSection } from "./StripePaymentSection";

/** Customer-borne service-fee rate as a display percentage (e.g. 12). */
const SERVICE_FEE_PERCENT = PLATFORM_APPLICATION_FEE_RATE * 100;

interface OrderCheckoutPageProps {
	orderId: Id<"orders">;
	onBackToMenu: () => void;
	onViewOrders: () => void;
}

/**
 * Per-order pay-at-submit checkout (ADR 008): the diner pays
 * `subtotal + {@link PLATFORM_APPLICATION_FEE_RATE} service fee` for one draft
 * order before the kitchen sees it, or commits it for in-person (cash)
 * payment (`awaiting_payment`). No tip UI here — tips happen at Visit
 * close-out (Phase 3B).
 *
 * Success is detected by subscription: the Stripe webhook flips the order's
 * `paymentState` to "paid", which this page observes through
 * `orders.getOrderWithItems`.
 */
export function OrderCheckoutPage({
	orderId,
	onBackToMenu,
	onViewOrders,
}: Readonly<OrderCheckoutPageProps>) {
	const { t } = useTranslation();
	const createPaymentIntent = useConvexAction(api.stripe.createPaymentIntent);
	const cancelPaymentIntent = useConvexAction(api.stripe.cancelOrderPaymentIntent);
	const requestPayInPerson = useMutation({
		mutationFn: useConvexMutation(api.orders.requestPayInPerson),
	});

	const [clientSecret, setClientSecret] = useState<string | null>(null);
	const [initializing, setInitializing] = useState(false);
	const [cashSubmitting, setCashSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const { data: order } = useQuery(convexQuery(api.orders.getOrderWithItems, { orderId }));

	// A webhook-reported decline surfaces through the subscription; drop the
	// Elements form so the next attempt creates a fresh intent.
	useEffect(() => {
		if (order?.paymentState === "failed") {
			setClientSecret(null);
			setError(order.activePayment?.failureMessage ?? t(OrderingKeys.CHECKOUT_PAYMENT_FAILED));
		}
	}, [order?.paymentState, order?.activePayment?.failureMessage, t]);

	const handleStartPayment = async () => {
		setInitializing(true);
		setError(null);
		try {
			const result = await createPaymentIntent({ orderId });
			setClientSecret(result?.clientSecret ?? null);
		} catch (err) {
			setError(getErrorMessage(err, t, OrderingKeys.CHECKOUT_INIT_FAILED));
			setClientSecret(null);
		} finally {
			setInitializing(false);
		}
	};

	// While a card intent is mounted, switching to cash REQUIRES cancelling it
	// first — the backend rejects `requestPayInPerson` with
	// ERROR_ORDER_PAYMENT_IN_FLIGHT otherwise, so a stale payment sheet can
	// never double-settle a cash order.
	const handlePayInPerson = async () => {
		setCashSubmitting(true);
		setError(null);
		try {
			const activeCardIntent =
				clientSecret !== null ||
				order?.activePayment?.status === "pending" ||
				order?.activePayment?.status === "processing";
			if (activeCardIntent) {
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

	if (order === undefined) {
		return (
			<div className="flex items-center justify-center h-full p-8">
				<Loader2 size={24} className="animate-spin text-faint-foreground" />
			</div>
		);
	}

	if (order === null) {
		return <OrderCheckoutFallback onBackToMenu={onBackToMenu} />;
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

	const liveItems = order.items.filter((item) => item.cancelledAt === undefined);
	const subtotal = order.totalAmount;
	const feeAmount = Math.round(subtotal * PLATFORM_APPLICATION_FEE_RATE);
	const total = subtotal + feeAmount;

	// Cash commitment confirmed (and no card retry mounted): show the diner the
	// number to call out. `clientSecret` wins so a cash→card switch keeps the
	// payment sheet on screen.
	if (order.status === "awaiting_payment" && !clientSecret) {
		return (
			<PayInPersonScreen
				dailyOrderNumber={order.dailyOrderNumber ?? null}
				totalAmount={order.totalAmount}
				error={error}
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
						onClick={onBackToMenu}
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
							<span className="shrink-0">${formatCents(item.lineTotal)}</span>
						</div>
					))}
					<div className="flex justify-between pt-2 text-sm border-t border-border text-muted-foreground">
						<span>{t(OrderingKeys.CHECKOUT_SUBTOTAL)}</span>
						<span>${formatCents(subtotal)}</span>
					</div>
					<div className="flex justify-between text-sm text-muted-foreground">
						<span>{t(OrderingKeys.CHECKOUT_SERVICE_FEE, { rate: SERVICE_FEE_PERCENT })}</span>
						<span>${formatCents(feeAmount)}</span>
					</div>
					<div className="flex justify-between pt-2 text-sm font-semibold border-t border-border text-foreground">
						<span>{t(OrderingKeys.CHECKOUT_TOTAL)}</span>
						<span>${formatCents(total)}</span>
					</div>
				</div>

				{error && (
					<div className="px-4 py-3 rounded-lg text-sm text-destructive bg-destructive-subtle">
						{error}
					</div>
				)}

				{clientSecret ? (
					<StripePaymentSection clientSecret={clientSecret} />
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
			<p className="text-2xl font-semibold text-foreground">${formatCents(totalAmount)}</p>
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
