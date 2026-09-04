/**
 * Visit close-out — "close your visit" (ADR 008; tip removed by TAVLI-99).
 *
 * The tip used to live here, per member, on the member's own visit total. It
 * now happens per order on the payment page: diners were not reaching this
 * screen, so they were not tipping.
 *
 * What is left is the reason this screen still has to exist. It is the only
 * path to `sessions.close`, and closing is not always allowed — an uncollected
 * cash order blocks it, and the diner has to be told why rather than left
 * tapping a button that does nothing. `getVisitSummary` stays caller-scoped,
 * so two friends on one tab each see only their own spend.
 *
 * The Stripe Elements branch that used to live here is gone with the tip
 * composition — with nothing able to start a charge, keeping the sheet would
 * have been unreachable code behind a comment claiming otherwise.
 * `stripe.createTipCharge` itself stays callable on the backend, so a session
 * that was mid-charge when this shipped still settles through its webhook.
 *
 * Tips already given this visit are still shown, so a diner sees what they
 * paid rather than a screen that quietly forgot.
 */
import { ErrorKeys, OrderingKeys } from "@/global/i18n";
import { getErrorMessage } from "@/global/utils/errorMessages";
import { formatCents } from "@/global/utils/money";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import { ArrowLeft, HandCoins, Heart, Loader2 } from "lucide-react";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../hooks/useSession";

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
	const closeSession = useConvexMutation(api.sessions.close);

	const [closing, setClosing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const { data: summary } = useQuery(
		convexQuery(api.sessions.getVisitSummary, sessionId ? { sessionId } : "skip")
	);

	const myPaidTotal = summary?.myPaidTotal ?? 0;

	/**
	 * Close the visit and leave. Closes only when the summary says it can be
	 * closed; otherwise surfaces the blocked reason and stays put, because the
	 * situation behind it — an uncollected cash order — needs staff, not
	 * another tap.
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
					<p className="text-sm text-faint-foreground text-center">
						{t(OrderingKeys.CLOSEOUT_NOTHING_PAID)}
					</p>
				) : null}

				<button
					type="button"
					onClick={handleFinish}
					disabled={closing}
					className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold hover-btn-primary disabled:opacity-50"
				>
					{closing ? <Loader2 size={16} className="animate-spin" /> : t(OrderingKeys.CLOSEOUT_DONE)}
				</button>
			</div>
		</div>
	);
}
