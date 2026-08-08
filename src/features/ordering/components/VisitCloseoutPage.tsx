/**
 * Visit close-out (ADR 008, TAVLI-71 Phase 3B).
 *
 * Each session member tips on their OWN paid total — `getVisitSummary` is
 * caller-scoped, so two friends on one tab each see only their own spend. The
 * tip is a separate `kind: "tip"` charge on the card saved at first order
 * payment (one tap, `off_session`), with **no commission**: 100% goes to the
 * restaurant. Walk-out costs nothing — "Skip" (and a custom tip of 0) closes
 * the session without charging.
 *
 * Flow:
 * - Preset chips ({@link TIP_PERCENT_PRESETS}) computed on `myPaidTotal`,
 *   default {@link DEFAULT_TIP_PERCENT}; Custom accepts any amount >= 0.
 * - "Add tip · $X" → `stripe.createTipCharge`. `clientSecret: null` means the
 *   saved card was charged one-tap → thank-you card. A client secret mounts
 *   the shared Elements sheet (3DS challenge or no saved card); success is
 *   observed through the summary subscription (the webhook records the tip).
 * - "Done"/"Skip" → `sessions.close` when the summary says the session is
 *   closable (otherwise the blocked reason is surfaced, e.g. an uncollected
 *   cash order), then the local session clears and the diner returns to the
 *   menu.
 * - A member who paid nothing by card sees no tip UI at all — just close.
 */
import { ErrorKeys, OrderingKeys } from "@/global/i18n";
import { getErrorMessage } from "@/global/utils/errorMessages";
import { formatCents } from "@/global/utils/money";
import { convexQuery, useConvexAction, useConvexMutation } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import { DEFAULT_TIP_PERCENT, TIP_PERCENT_PRESETS } from "convex/constants";
import { ArrowLeft, CheckCircle2, HandCoins, Heart, Loader2, ShieldCheck } from "lucide-react";
import type { TFunction } from "i18next";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../hooks/useSession";
import { StripePaymentSection } from "./StripePaymentSection";

/** Sentinel for the Custom chip (presets are positive percentages). */
const CUSTOM_TIP = -1;

interface VisitCloseoutPageProps {
	onBackToOrders: () => void;
	/** Called after the session is closed (or already closed) and cleared. */
	onDone: () => void;
}

/**
 * Maps a `closeBlockedReason` stable code (e.g.
 * `ERROR_SESSION_AWAITING_PAYMENT_ORDERS`) to its localized message.
 */
function blockedReasonMessage(t: TFunction, code: string | null): string | null {
	if (!code) return null;
	const key = (ErrorKeys as Record<string, string>)[code];
	return t(key ?? ErrorKeys.GENERIC);
}

export function VisitCloseoutPage({ onBackToOrders, onDone }: Readonly<VisitCloseoutPageProps>) {
	const { t } = useTranslation();
	const { sessionId, clearSession } = useSessionStore();
	const createTipCharge = useConvexAction(api.stripe.createTipCharge);
	const closeSession = useConvexMutation(api.sessions.close);

	const [tipPercent, setTipPercent] = useState<number>(DEFAULT_TIP_PERCENT);
	const [customTipInput, setCustomTipInput] = useState("");
	const [clientSecret, setClientSecret] = useState<string | null>(null);
	/** Tip payments visible when the Elements sheet mounted — growth = success. */
	const [tipCountAtSubmit, setTipCountAtSubmit] = useState<number | null>(null);
	/** Amount of the tip that just went through (one-tap or Elements). */
	const [thanksAmount, setThanksAmount] = useState<number | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [closing, setClosing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const { data: summary } = useQuery(
		convexQuery(api.sessions.getVisitSummary, sessionId ? { sessionId } : "skip")
	);

	const myPaidTotal = summary?.myPaidTotal ?? 0;
	const tipAmount = useMemo(() => {
		if (tipPercent === CUSTOM_TIP) {
			const parsed = Number.parseFloat(customTipInput);
			if (!Number.isFinite(parsed) || parsed < 0) return 0;
			return Math.round(parsed * 100);
		}
		return Math.round((myPaidTotal * tipPercent) / 100);
	}, [tipPercent, customTipInput, myPaidTotal]);

	// Elements success: the webhook records the tip, the summary subscription
	// grows `myTipPayments`, and the sheet flips to the thank-you card.
	useEffect(() => {
		if (clientSecret !== null && tipCountAtSubmit !== null && summary) {
			if (summary.myTipPayments.length > tipCountAtSubmit) {
				const latest = summary.myTipPayments[summary.myTipPayments.length - 1];
				setClientSecret(null);
				setThanksAmount(latest?.amount ?? null);
			}
		}
	}, [clientSecret, tipCountAtSubmit, summary]);

	// A webhook-reported decline of the mounted attempt: drop the sheet so the
	// next attempt starts a fresh charge (the failed row is superseded).
	useEffect(() => {
		if (clientSecret === null) return;
		if (summary?.myActiveTipPayment?.status === "failed") {
			setClientSecret(null);
			setError(
				summary.myActiveTipPayment.failureMessage ?? t(OrderingKeys.CHECKOUT_PAYMENT_FAILED)
			);
		}
	}, [
		clientSecret,
		summary?.myActiveTipPayment?.status,
		summary?.myActiveTipPayment?.failureMessage,
		t,
	]);

	/**
	 * Close-then-leave, shared by Done, Skip, and a custom tip of 0. Closes the
	 * session only when the summary says it can be closed; otherwise surfaces
	 * the blocked reason and stays (the food/cash situation needs staff).
	 */
	const handleFinish = async () => {
		if (!sessionId || !summary) return;
		setClosing(true);
		setError(null);
		try {
			if (summary.sessionStatus === "active") {
				if (!summary.canClose) {
					setError(blockedReasonMessage(t, summary.closeBlockedReason) ?? t(ErrorKeys.GENERIC));
					return;
				}
				await closeSession({ sessionId });
			}
			clearSession();
			onDone();
		} catch (err) {
			setError(getErrorMessage(err, t, OrderingKeys.CHECKOUT_GENERIC_ERROR));
		} finally {
			setClosing(false);
		}
	};

	const handleAddTip = async () => {
		if (!sessionId) return;
		// A custom tip of 0 is an explicit skip — never charged (backend rejects
		// non-positive amounts with ERROR_TIP_INVALID_AMOUNT anyway).
		if (tipAmount <= 0) {
			await handleFinish();
			return;
		}
		setSubmitting(true);
		setError(null);
		try {
			setTipCountAtSubmit(summary?.myTipPayments.length ?? 0);
			const result = await createTipCharge({ sessionId, tipAmount });
			if (result?.clientSecret) {
				// 3DS challenge or no saved card — confirm in the payment sheet.
				setClientSecret(result.clientSecret);
			} else {
				// One tap on the saved card went through (webhook records it).
				setThanksAmount(tipAmount);
			}
		} catch (err) {
			setError(getErrorMessage(err, t, OrderingKeys.CHECKOUT_GENERIC_ERROR));
		} finally {
			setSubmitting(false);
		}
	};

	if (!sessionId || summary === null) {
		return (
			<div className="flex flex-col items-center justify-center h-full p-8 gap-3">
				<p className="text-sm text-faint-foreground">{t(OrderingKeys.SESSION_NO_SESSION)}</p>
				<button
					onClick={onDone}
					className="px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
				>
					{t(OrderingKeys.BACK_TO_MENU)}
				</button>
			</div>
		);
	}

	if (summary === undefined) {
		return (
			<div className="flex items-center justify-center h-full p-8">
				<Loader2 size={24} className="animate-spin text-faint-foreground" />
			</div>
		);
	}

	const blockedNotice =
		summary.sessionStatus === "active" && !summary.canClose
			? blockedReasonMessage(t, summary.closeBlockedReason)
			: null;
	const tipsGivenTotal = summary.myTipPayments.reduce((sum, tip) => sum + tip.amount, 0);

	if (thanksAmount !== null) {
		return (
			<div className="flex flex-col items-center justify-center h-full p-8 gap-4 text-center">
				<div className="w-16 h-16 rounded-full flex items-center justify-center bg-success-subtle">
					<CheckCircle2 size={32} style={{ color: "var(--accent-success)" }} />
				</div>
				<h2 className="text-lg font-bold text-foreground">
					{t(OrderingKeys.CLOSEOUT_THANKS_TITLE)}
				</h2>
				<p className="text-sm max-w-xs text-muted-foreground">
					{t(OrderingKeys.CLOSEOUT_THANKS_BODY, { amount: formatCents(thanksAmount) })}
				</p>

				{blockedNotice && (
					<div className="px-4 py-3 rounded-lg text-sm text-muted-foreground bg-muted max-w-sm">
						{blockedNotice}
					</div>
				)}
				{error && (
					<div className="px-4 py-3 rounded-lg text-sm text-destructive bg-destructive-subtle max-w-sm">
						{error}
					</div>
				)}

				<button
					onClick={handleFinish}
					disabled={closing}
					className="mt-2 px-6 py-2.5 rounded-xl text-sm font-medium hover-btn-primary disabled:opacity-50"
				>
					{closing ? (
						<Loader2 size={16} className="animate-spin mx-auto" />
					) : (
						t(OrderingKeys.CLOSEOUT_DONE)
					)}
				</button>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full w-full overflow-y-auto">
			<div className="flex flex-col max-w-lg w-full mx-auto p-4 pb-8 space-y-6">
				<div className="flex items-center gap-3">
					<button
						onClick={onBackToOrders}
						className="p-2 rounded-lg hover:bg-(--bg-hover) text-foreground"
						aria-label={t(OrderingKeys.BACK_TO_MENU_ARIA)}
					>
						<ArrowLeft size={20} />
					</button>
					<h2 className="text-lg font-bold text-foreground">{t(OrderingKeys.CLOSEOUT_HEADING)}</h2>
				</div>

				{/* The caller's own spend this visit (their paid orders only). */}
				<div className="rounded-xl p-4 space-y-2 bg-muted border border-border">
					<div className="flex justify-between text-sm text-muted-foreground">
						<span>{t(OrderingKeys.CLOSEOUT_VISIT_TOTAL)}</span>
						<span className="font-semibold text-foreground">${formatCents(myPaidTotal)}</span>
					</div>
					<div className="flex justify-between text-xs text-faint-foreground">
						<span>{t(OrderingKeys.CLOSEOUT_ORDER_COUNT, { count: summary.myOrderCount })}</span>
					</div>
					{tipsGivenTotal > 0 && (
						<div
							className="flex items-center gap-2 pt-2 text-sm border-t border-border"
							style={{ color: "var(--accent-success)" }}
						>
							<Heart size={14} />
							<span>
								{t(OrderingKeys.CLOSEOUT_TIPS_GIVEN, { amount: formatCents(tipsGivenTotal) })}
							</span>
						</div>
					)}
				</div>

				{blockedNotice && (
					<div className="flex items-start gap-2 px-4 py-3 rounded-lg text-sm text-muted-foreground bg-muted">
						<HandCoins size={16} className="shrink-0 mt-0.5" />
						<span>{blockedNotice}</span>
					</div>
				)}

				{error && (
					<div className="px-4 py-3 rounded-lg text-sm text-destructive bg-destructive-subtle">
						{error}
					</div>
				)}

				{myPaidTotal <= 0 ? (
					// This member paid nothing by card — no tip UI, just close.
					<>
						<p className="text-sm text-faint-foreground text-center">
							{t(OrderingKeys.CLOSEOUT_NOTHING_PAID)}
						</p>
						<button
							type="button"
							onClick={handleFinish}
							disabled={closing}
							className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold hover-btn-primary disabled:opacity-50"
						>
							{closing ? (
								<Loader2 size={16} className="animate-spin" />
							) : (
								t(OrderingKeys.CLOSEOUT_DONE)
							)}
						</button>
					</>
				) : clientSecret ? (
					<>
						<h3 className="text-sm font-semibold text-foreground">
							{t(OrderingKeys.CLOSEOUT_PAYMENT_TITLE)}
						</h3>
						<StripePaymentSection
							clientSecret={clientSecret}
							submitLabel={t(OrderingKeys.CLOSEOUT_ADD_TIP_CTA, {
								amount: formatCents(tipAmount),
							})}
						/>
						<button
							type="button"
							onClick={() => setClientSecret(null)}
							className="text-xs font-medium underline text-muted-foreground mx-auto"
						>
							{t(OrderingKeys.TAB_CHANGE_TIP)}
						</button>
					</>
				) : (
					<>
						{/* Tip selector: presets on the member's own paid total. */}
						<div className="space-y-2">
							<h3 className="text-sm font-semibold text-foreground">
								{t(OrderingKeys.CLOSEOUT_TIP_HEADING)}
							</h3>
							<div className="flex gap-2">
								{TIP_PERCENT_PRESETS.map((pct) => (
									<button
										key={pct}
										type="button"
										onClick={() => setTipPercent(pct)}
										aria-label={t(OrderingKeys.CLOSEOUT_PRESET_ARIA, { percent: pct })}
										className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border flex flex-col items-center ${
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
										<span>{pct}%</span>
										<span className="text-xs opacity-80">
											${formatCents(Math.round((myPaidTotal * pct) / 100))}
										</span>
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
									{t(OrderingKeys.CLOSEOUT_TIP_CUSTOM)}
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
									placeholder={t(OrderingKeys.CLOSEOUT_TIP_CUSTOM_PLACEHOLDER)}
									className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
									aria-label={t(OrderingKeys.CLOSEOUT_TIP_CUSTOM_PLACEHOLDER)}
								/>
							)}
						</div>

						<button
							type="button"
							onClick={handleAddTip}
							disabled={submitting || closing}
							className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold hover-btn-primary disabled:opacity-50"
						>
							{submitting ? (
								<>
									<Loader2 size={16} className="animate-spin" />
									{t(OrderingKeys.CHECKOUT_PROCESSING)}
								</>
							) : (
								<>
									<Heart size={16} />
									{t(OrderingKeys.CLOSEOUT_ADD_TIP_CTA, { amount: formatCents(tipAmount) })}
								</>
							)}
						</button>
					</>
				)}

				{/* Walk-away path — always available, never charges. */}
				{myPaidTotal > 0 && (
					<button
						type="button"
						onClick={handleFinish}
						disabled={closing || submitting}
						className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border border-border text-foreground hover:bg-(--bg-hover) disabled:opacity-50"
					>
						{closing ? (
							<Loader2 size={16} className="animate-spin" />
						) : (
							t(OrderingKeys.CLOSEOUT_SKIP)
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
