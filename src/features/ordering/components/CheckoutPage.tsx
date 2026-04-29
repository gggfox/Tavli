import { OrderingKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import { convexQuery, useConvexAction } from "@convex-dev/react-query";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Appearance } from "@stripe/stripe-js";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { ArrowLeft, CreditCard, Loader2, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

const LIGHT_APPEARANCE: Appearance = {
	theme: "stripe",
	variables: {
		colorPrimary: "#2383e2",
		colorBackground: "#ffffff",
		colorText: "#37352f",
		colorTextSecondary: "#787774",
		colorTextPlaceholder: "#9b9a97",
		colorDanger: "#e03e3e",
		borderRadius: "8px",
	},
};

const DARK_APPEARANCE: Appearance = {
	theme: "night",
	variables: {
		colorPrimary: "#2383e2",
		colorBackground: "#252525",
		colorText: "#ffffffcf",
		colorTextSecondary: "#9b9a97",
		colorTextPlaceholder: "#5a5a5a",
		colorDanger: "#eb5757",
		borderRadius: "8px",
	},
};

function useIsDarkTheme(): boolean {
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

interface CheckoutPageProps {
	orderId: string;
	onBackToMenu: () => void;
	onOrderPlaced: (orderId: string) => void;
}

export function CheckoutPage({
	orderId,
	onBackToMenu,
	onOrderPlaced,
}: Readonly<CheckoutPageProps>) {
	const { t } = useTranslation();
	const createPaymentIntent = useConvexAction(api.stripe.createPaymentIntent);
	const [clientSecret, setClientSecret] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	const { data: orderData } = useQuery(
		convexQuery(api.orders.getOrderWithItems, { orderId: orderId as Id<"orders"> })
	);

	const initPayment = useCallback(async () => {
		try {
			setLoading(true);
			setError(null);
			const result = await createPaymentIntent({
				orderId: orderId as Id<"orders">,
			});
			if (result?.clientSecret) {
				setClientSecret(result.clientSecret);
			} else {
				setClientSecret(null);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : t(OrderingKeys.CHECKOUT_INIT_FAILED));
			setClientSecret(null);
		} finally {
			setLoading(false);
		}
	}, [createPaymentIntent, orderId, t]);

	useEffect(() => {
		if (!orderData || orderData.status !== "draft") {
			return;
		}
		if (orderData.totalAmount <= 0) {
			setLoading(false);
			return;
		}
		if (orderData.paymentState === "failed") {
			setLoading(false);
			setClientSecret(null);
			setError(
				orderData.activePayment?.failureMessage ?? t(OrderingKeys.CHECKOUT_PAYMENT_FAILED)
			);
			return;
		}
		if (
			orderData.paymentState === "unpaid" ||
			orderData.paymentState === "pending" ||
			orderData.paymentState === "processing" ||
			orderData.paymentState === undefined
		) {
			initPayment();
		}
	}, [
		orderData,
		orderData?.activePayment?.failureMessage,
		orderData?.paymentState,
		orderData?.status,
		orderData?.totalAmount,
		initPayment,
	]);

	if (!orderData) {
		return (
			<div className="flex items-center justify-center h-full p-8">
				<Loader2 size={24} className="animate-spin text-faint-foreground"  />
			</div>
		);
	}

	if (orderData.status !== "draft") {
		onOrderPlaced(orderId);
		return null;
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
						<ArrowLeft size={20}  />
					</button>
					<h2 className="text-lg font-bold text-foreground" >
						{t(OrderingKeys.CHECKOUT_HEADING)}
					</h2>
				</div>

				{/* Order Summary */}
				<div
					className="rounded-xl p-4 space-y-3 bg-muted border border-border"
					
				>
					<h3 className="text-sm font-semibold text-foreground" >
						{t(OrderingKeys.CHECKOUT_ORDER_SUMMARY)}
					</h3>
					{orderData.items.map((item) => (
						<div
							key={item._id}
							className="flex justify-between text-sm text-muted-foreground"
							
						>
							<span>
								{item.quantity}x {item.menuItemName}
							</span>
							<span>${formatCents(item.lineTotal)}</span>
						</div>
					))}
					<div
						className="flex justify-between pt-3 text-sm font-semibold border-t border-border text-foreground"
						
					>
						<span>{t(OrderingKeys.CHECKOUT_TOTAL)}</span>
						<span>${formatCents(orderData.totalAmount)}</span>
					</div>
				</div>

				{error && (
					<div
						className="px-4 py-3 rounded-lg text-sm text-destructive"
						style={{backgroundColor: "rgba(220, 38, 38, 0.1)"}}
					>
						{error}
					</div>
				)}

				<PaymentSection
					loading={loading}
					clientSecret={clientSecret}
					orderId={orderId}
					onOrderPlaced={onOrderPlaced}
					onRetry={initPayment}
				/>

				<div
					className="flex items-center justify-center gap-2 text-xs text-faint-foreground"
					
				>
					<ShieldCheck size={14} />
					<span>{t(OrderingKeys.CHECKOUT_SECURED_BY_STRIPE)}</span>
				</div>
			</div>
		</div>
	);
}

function PaymentSection({
	loading,
	clientSecret,
	orderId,
	onOrderPlaced,
	onRetry,
}: Readonly<{
	loading: boolean;
	clientSecret: string | null;
	orderId: string;
	onOrderPlaced: (orderId: string) => void;
	onRetry: () => void;
}>) {
	const { t } = useTranslation();
	const isDark = useIsDarkTheme();
	const elementsOptions = useMemo(
		() =>
			clientSecret
				? {
						clientSecret,
						appearance: isDark ? DARK_APPEARANCE : LIGHT_APPEARANCE,
					}
				: null,
		[clientSecret, isDark]
	);

	if (loading) {
		return (
			<div className="flex items-center justify-center py-8">
				<Loader2 size={24} className="animate-spin text-faint-foreground"  />
			</div>
		);
	}

	if (clientSecret && elementsOptions) {
		// Remount Elements when theme changes so Stripe picks up the new appearance.
		return (
			<Elements key={isDark ? "dark" : "light"} stripe={stripePromise} options={elementsOptions}>
				<PaymentForm orderId={orderId} onSuccess={() => onOrderPlaced(orderId)} />
			</Elements>
		);
	}

	return (
		<div className="text-center py-8">
			<p className="text-sm text-faint-foreground" >
				{t(OrderingKeys.CHECKOUT_UNABLE_INIT)}
			</p>
			<button
				onClick={onRetry}
				className="mt-3 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
			>
				{t(OrderingKeys.CHECKOUT_RETRY)}
			</button>
		</div>
	);
}

function PaymentForm({
	orderId,
	onSuccess,
}: Readonly<{
	orderId: string;
	onSuccess: () => void;
}>) {
	const { t } = useTranslation();
	const stripe = useStripe();
	const elements = useElements();
	const [processing, setProcessing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const { data: orderData } = useQuery(
		convexQuery(api.orders.getOrderWithItems, { orderId: orderId as Id<"orders"> })
	);

	useEffect(() => {
		if (orderData?.status === "submitted") {
			onSuccess();
		}
	}, [orderData?.status, onSuccess]);

	useEffect(() => {
		if (orderData?.paymentState === "failed") {
			setProcessing(false);
			setError(
				orderData.activePayment?.failureMessage ?? t(OrderingKeys.CHECKOUT_GENERIC_ERROR)
			);
		}
	}, [orderData?.activePayment?.failureMessage, orderData?.paymentState, t]);

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

		// Payment succeeded client-side. The webhook will transition the order to "submitted".
		// We use Convex real-time subscription (via useQuery above) to detect the transition.
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<PaymentElement />

			{error && (
				<div
					className="px-4 py-3 rounded-lg text-sm text-destructive"
					style={{backgroundColor: "rgba(220, 38, 38, 0.1)"}}
				>
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
						{t(OrderingKeys.CHECKOUT_PAY_NOW)}
					</>
				)}
			</button>
		</form>
	);
}
