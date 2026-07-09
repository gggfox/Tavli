import { OrderingKeys } from "@/global/i18n";
import { formatCents } from "@/global/utils/money";
import { convexQuery, useConvexAction, useConvexMutation } from "@convex-dev/react-query";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Appearance } from "@stripe/stripe-js";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { DEFAULT_TIP_PERCENT, TIP_PERCENT_PRESETS } from "convex/constants";
import { ArrowLeft, CheckCircle2, CreditCard, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../hooks/useSession";

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

const CUSTOM_TIP = -1;

interface TabCheckoutPageProps {
	onBackToTab: () => void;
	/** Called from the success screen; the paid session is already closed. */
	onDone: () => void;
}

/**
 * End-of-visit tab checkout (TAVLI-6): one Stripe payment covers every order
 * in the session plus the tip. Default tip 10%, adjustable, never below 0.
 */
export function TabCheckoutPage({ onBackToTab, onDone }: Readonly<TabCheckoutPageProps>) {
	const { t } = useTranslation();
	const { sessionId, clearSession } = useSessionStore();
	const createTabPaymentIntent = useConvexAction(api.stripe.createTabPaymentIntent);
	const cancelTabPayment = useMutation({
		mutationFn: useConvexMutation(api.sessions.cancelTabPayment),
	});

	const [tipPercent, setTipPercent] = useState<number>(DEFAULT_TIP_PERCENT);
	const [customTipInput, setCustomTipInput] = useState("");
	const [clientSecret, setClientSecret] = useState<string | null>(null);
	const [initializing, setInitializing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [paid, setPaid] = useState(false);

	const { data: tab } = useQuery(
		convexQuery(
			api.sessions.getTabSummary,
			sessionId ? { sessionId: sessionId as Id<"sessions"> } : "skip"
		)
	);

	// The webhook closes the session on success, which makes getTabSummary
	// return null. Reaching checkout with a payment in flight and then losing
	// the tab therefore means the payment settled.
	useEffect(() => {
		if (tab?.paymentState === "paid") setPaid(true);
	}, [tab?.paymentState]);
	useEffect(() => {
		if (clientSecret && tab === null) setPaid(true);
	}, [clientSecret, tab]);

	useEffect(() => {
		if (tab?.paymentState === "failed") {
			setClientSecret(null);
			setError(tab.activePayment?.failureMessage ?? t(OrderingKeys.CHECKOUT_PAYMENT_FAILED));
		}
	}, [tab?.paymentState, tab?.activePayment?.failureMessage, t]);

	const subtotal = tab?.subtotal ?? 0;
	const tipAmount = useMemo(() => {
		if (tipPercent === CUSTOM_TIP) {
			const parsed = Number.parseFloat(customTipInput);
			if (!Number.isFinite(parsed) || parsed < 0) return 0;
			return Math.round(parsed * 100);
		}
		return Math.round((subtotal * tipPercent) / 100);
	}, [tipPercent, customTipInput, subtotal]);
	const total = subtotal + tipAmount;

	const handleStartPayment = async () => {
		if (!sessionId) return;
		setInitializing(true);
		setError(null);
		try {
			const result = await createTabPaymentIntent({
				sessionId: sessionId as Id<"sessions">,
				tipAmount,
			});
			setClientSecret(result?.clientSecret ?? null);
		} catch (err) {
			setError(err instanceof Error ? err.message : t(OrderingKeys.CHECKOUT_INIT_FAILED));
			setClientSecret(null);
		} finally {
			setInitializing(false);
		}
	};

	const handleChangeTip = async () => {
		setClientSecret(null);
		setError(null);
		if (sessionId) {
			// Unlock the tab so the amount can change (abandons the old intent).
			try {
				await cancelTabPayment.mutateAsync({ sessionId: sessionId as Id<"sessions"> });
			} catch {
				// Tab may already be unlocked — the next intent creation re-validates.
			}
		}
	};

	if (paid) {
		return (
			<TabPaidScreen
				onDone={() => {
					clearSession();
					onDone();
				}}
			/>
		);
	}

	if (!sessionId || tab === undefined) {
		return (
			<div className="flex items-center justify-center h-full p-8">
				<Loader2 size={24} className="animate-spin text-faint-foreground" />
			</div>
		);
	}

	if (tab === null || subtotal <= 0) {
		return (
			<div className="flex flex-col items-center justify-center h-full p-8 gap-3">
				<p className="text-sm text-faint-foreground">{t(OrderingKeys.TAB_EMPTY)}</p>
				<button
					onClick={onBackToTab}
					className="px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
				>
					{t(OrderingKeys.BACK_TO_MENU)}
				</button>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full w-full overflow-y-auto">
			<div className="flex flex-col max-w-lg w-full mx-auto p-4 pb-8 space-y-6">
				<div className="flex items-center gap-3">
					<button
						onClick={onBackToTab}
						className="p-2 rounded-lg hover:bg-(--bg-hover) text-foreground"
						aria-label={t(OrderingKeys.BACK_TO_MENU_ARIA)}
					>
						<ArrowLeft size={20} />
					</button>
					<h2 className="text-lg font-bold text-foreground">{t(OrderingKeys.TAB_PAY_HEADING)}</h2>
				</div>

				{/* Amount summary */}
				<div className="rounded-xl p-4 space-y-2 bg-muted border border-border">
					<div className="flex justify-between text-sm text-muted-foreground">
						<span>{t(OrderingKeys.TAB_SUBTOTAL, { count: tab.payableOrderIds.length })}</span>
						<span>${formatCents(subtotal)}</span>
					</div>
					<div className="flex justify-between text-sm text-muted-foreground">
						<span>{t(OrderingKeys.TAB_TIP_LABEL)}</span>
						<span>${formatCents(tipAmount)}</span>
					</div>
					<div className="flex justify-between pt-2 text-sm font-semibold border-t border-border text-foreground">
						<span>{t(OrderingKeys.CHECKOUT_TOTAL)}</span>
						<span>${formatCents(total)}</span>
					</div>
				</div>

				{/* Tip selector — hidden once the payment intent exists */}
				{!clientSecret && (
					<div className="space-y-2">
						<h3 className="text-sm font-semibold text-foreground">
							{t(OrderingKeys.TAB_TIP_HEADING)}
						</h3>
						<div className="flex gap-2">
							{TIP_PERCENT_PRESETS.map((pct) => (
								<button
									key={pct}
									type="button"
									onClick={() => setTipPercent(pct)}
									className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
										tipPercent === pct ? "" : "hover-secondary"
									}`}
									style={
										tipPercent === pct
											? {
													backgroundColor: "var(--btn-primary-bg)",
													color: "var(--btn-primary-text)",
													borderColor: "var(--btn-primary-bg)",
												}
											: {
													borderColor: "var(--border-default)",
													color: "var(--text-secondary)",
												}
									}
								>
									{pct}%
								</button>
							))}
							<button
								type="button"
								onClick={() => setTipPercent(CUSTOM_TIP)}
								className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
									tipPercent === CUSTOM_TIP ? "" : "hover-secondary"
								}`}
								style={
									tipPercent === CUSTOM_TIP
										? {
												backgroundColor: "var(--btn-primary-bg)",
												color: "var(--btn-primary-text)",
												borderColor: "var(--btn-primary-bg)",
											}
										: {
												borderColor: "var(--border-default)",
												color: "var(--text-secondary)",
											}
								}
							>
								{t(OrderingKeys.TAB_TIP_CUSTOM)}
							</button>
						</div>
						{tipPercent === CUSTOM_TIP && (
							<input
								type="number"
								min="0"
								step="0.01"
								inputMode="decimal"
								value={customTipInput}
								onChange={(e) => setCustomTipInput(e.target.value)}
								placeholder={t(OrderingKeys.TAB_TIP_CUSTOM_PLACEHOLDER)}
								className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
								aria-label={t(OrderingKeys.TAB_TIP_CUSTOM_PLACEHOLDER)}
							/>
						)}
					</div>
				)}

				{error && (
					<div
						className="px-4 py-3 rounded-lg text-sm text-destructive"
						style={{ backgroundColor: "rgba(220, 38, 38, 0.1)" }}
					>
						{error}
					</div>
				)}

				{clientSecret ? (
					<>
						<TabPaymentSection
							clientSecret={clientSecret}
							sessionId={sessionId as Id<"sessions">}
							onSuccess={() => setPaid(true)}
						/>
						<button
							type="button"
							onClick={handleChangeTip}
							className="text-xs font-medium underline text-muted-foreground mx-auto"
						>
							{t(OrderingKeys.TAB_CHANGE_TIP)}
						</button>
					</>
				) : (
					<button
						type="button"
						onClick={handleStartPayment}
						disabled={initializing}
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
								{t(OrderingKeys.TAB_CONTINUE_TO_PAYMENT)}
							</>
						)}
					</button>
				)}

				<div className="flex items-center justify-center gap-2 text-xs text-faint-foreground">
					<ShieldCheck size={14} />
					<span>{t(OrderingKeys.CHECKOUT_SECURED_BY_STRIPE)}</span>
				</div>
			</div>
		</div>
	);
}

function TabPaymentSection({
	clientSecret,
	sessionId,
	onSuccess,
}: Readonly<{
	clientSecret: string;
	sessionId: Id<"sessions">;
	onSuccess: () => void;
}>) {
	const isDark = useIsDarkTheme();
	const elementsOptions = useMemo(
		() => ({
			clientSecret,
			appearance: isDark ? DARK_APPEARANCE : LIGHT_APPEARANCE,
		}),
		[clientSecret, isDark]
	);

	return (
		<Elements key={isDark ? "dark" : "light"} stripe={stripePromise} options={elementsOptions}>
			<TabPaymentForm sessionId={sessionId} onSuccess={onSuccess} />
		</Elements>
	);
}

function TabPaymentForm({
	sessionId,
	onSuccess,
}: Readonly<{
	sessionId: Id<"sessions">;
	onSuccess: () => void;
}>) {
	const { t } = useTranslation();
	const stripe = useStripe();
	const elements = useElements();
	const [processing, setProcessing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const { data: tab } = useQuery(convexQuery(api.sessions.getTabSummary, { sessionId }));

	// Success: webhook marks the tab paid and closes the session (summary
	// flips to "paid" for an instant, then becomes null).
	useEffect(() => {
		if (tab?.paymentState === "paid" || (processing && tab === null)) {
			onSuccess();
		}
	}, [tab, processing, onSuccess]);

	useEffect(() => {
		if (tab?.paymentState === "failed") {
			setProcessing(false);
			setError(tab.activePayment?.failureMessage ?? t(OrderingKeys.CHECKOUT_GENERIC_ERROR));
		}
	}, [tab?.paymentState, tab?.activePayment?.failureMessage, t]);

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
		// On success the webhook settles the tab; the subscription above
		// detects it and flips to the success screen.
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<PaymentElement />

			{error && (
				<div
					className="px-4 py-3 rounded-lg text-sm text-destructive"
					style={{ backgroundColor: "rgba(220, 38, 38, 0.1)" }}
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

function TabPaidScreen({ onDone }: Readonly<{ onDone: () => void }>) {
	const { t } = useTranslation();
	return (
		<div className="flex flex-col items-center justify-center h-full p-8 gap-4 text-center">
			<div
				className="w-16 h-16 rounded-full flex items-center justify-center"
				style={{ backgroundColor: "rgba(5, 150, 105, 0.12)" }}
			>
				<CheckCircle2 size={32} style={{ color: "var(--accent-success)" }} />
			</div>
			<h2 className="text-lg font-bold text-foreground">{t(OrderingKeys.TAB_PAID_TITLE)}</h2>
			<p className="text-sm max-w-xs text-muted-foreground">{t(OrderingKeys.TAB_PAID_DESC)}</p>
			<button
				onClick={onDone}
				className="mt-2 px-6 py-2.5 rounded-xl text-sm font-medium hover-btn-primary"
			>
				{t(OrderingKeys.TAB_PAID_DONE)}
			</button>
		</div>
	);
}
