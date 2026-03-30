import { formatCents } from "@/global/utils/money";
import { convexQuery, useConvexAction } from "@convex-dev/react-query";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { ArrowLeft, CreditCard, Loader2, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

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
			if (result.clientSecret) {
				setClientSecret(result.clientSecret);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to initialize payment");
		} finally {
			setLoading(false);
		}
	}, [createPaymentIntent, orderId]);

	useEffect(() => {
		if (orderData?.status === "draft" && orderData.totalAmount > 0) {
			initPayment();
		}
	}, [orderData?.status, orderData?.totalAmount, initPayment]);

	if (!orderData) {
		return (
			<div className="flex items-center justify-center h-full p-8">
				<Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
			</div>
		);
	}

	if (orderData.status !== "draft") {
		onOrderPlaced(orderId);
		return null;
	}

	return (
		<div className="flex flex-col h-full max-w-lg mx-auto p-4 space-y-6">
			<div className="flex items-center gap-3">
				<button onClick={onBackToMenu} className="p-2 rounded-lg hover:bg-(--bg-hover)">
					<ArrowLeft size={20} style={{ color: "var(--text-primary)" }} />
				</button>
				<h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
					Checkout
				</h2>
			</div>

			{/* Order Summary */}
			<div
				className="rounded-xl p-4 space-y-3"
				style={{
					backgroundColor: "var(--bg-secondary)",
					border: "1px solid var(--border-default)",
				}}
			>
				<h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
					Order Summary
				</h3>
				{orderData.items.map((item) => (
					<div
						key={item._id}
						className="flex justify-between text-sm"
						style={{ color: "var(--text-secondary)" }}
					>
						<span>
							{item.quantity}x {item.menuItemName}
						</span>
						<span>${formatCents(item.lineTotal)}</span>
					</div>
				))}
				<div
					className="flex justify-between pt-3 text-sm font-semibold"
					style={{
						borderTop: "1px solid var(--border-default)",
						color: "var(--text-primary)",
					}}
				>
					<span>Total</span>
					<span>${formatCents(orderData.totalAmount)}</span>
				</div>
			</div>

			{error && (
				<div
					className="px-4 py-3 rounded-lg text-sm"
					style={{
						backgroundColor: "rgba(220, 38, 38, 0.1)",
						color: "var(--accent-danger, #dc2626)",
					}}
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
				className="flex items-center justify-center gap-2 text-xs"
				style={{ color: "var(--text-muted)" }}
			>
				<ShieldCheck size={14} />
				<span>Payments secured by Stripe</span>
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
	if (loading) {
		return (
			<div className="flex items-center justify-center py-8">
				<Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
			</div>
		);
	}

	if (clientSecret) {
		return (
			<Elements
				stripe={stripePromise}
				options={{
					clientSecret,
					appearance: {
						theme: "stripe",
						variables: {
							colorPrimary: "#6366f1",
							borderRadius: "8px",
						},
					},
				}}
			>
				<PaymentForm orderId={orderId} onSuccess={() => onOrderPlaced(orderId)} />
			</Elements>
		);
	}

	return (
		<div className="text-center py-8">
			<p className="text-sm" style={{ color: "var(--text-muted)" }}>
				Unable to initialize payment. Please try again.
			</p>
			<button
				onClick={onRetry}
				className="mt-3 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
			>
				Retry
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

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!stripe || !elements) return;

		setProcessing(true);
		setError(null);

		const { error: submitError } = await elements.submit();
		if (submitError) {
			setError(submitError.message ?? "Payment failed");
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
			setError(confirmError.message ?? "Payment failed");
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
					className="px-4 py-3 rounded-lg text-sm"
					style={{
						backgroundColor: "rgba(220, 38, 38, 0.1)",
						color: "var(--accent-danger, #dc2626)",
					}}
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
						Processing...
					</>
				) : (
					<>
						<CreditCard size={16} />
						Pay Now
					</>
				)}
			</button>
		</form>
	);
}
