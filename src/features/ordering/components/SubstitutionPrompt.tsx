/**
 * Diner-side substitution prompt (ADR 008, TAVLI-71 Phase 3A).
 *
 * Mounted in the localized diner layout (`/r/$slug/$lang`) so it surfaces on
 * the menu, orders, and checkout pages alike: when the kitchen proposes a
 * replacement for a paid line, a modal pops on the diner's device showing the
 * original vs. proposed item and the exact extra charge (delta + service fee
 * on the delta), or "no extra charge" for an equal swap.
 *
 * - **Accept, delta 0** → `substitutions.acceptProposal` swaps in place.
 * - **Accept, delta > 0** → `stripe.createSubstitutionPaymentIntent`: one tap
 *   on the saved card when possible (`clientSecret: null` → success screen);
 *   otherwise the returned client secret mounts the shared Elements sheet.
 *   Either way the webhook applies the swap — the proposal leaving the pending
 *   subscription is the success signal.
 * - **Decline** → confirm dialog (mentions the automatic refund of that line)
 *   → `substitutions.declineProposal`.
 */
import { OrderingKeys } from "@/global/i18n";
import { getErrorMessage } from "@/global/utils/errorMessages";
import { formatCents } from "@/global/utils/money";
import { convexQuery, useConvexAction, useConvexMutation } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { PLATFORM_APPLICATION_FEE_RATE } from "convex/constants";
import { CheckCircle2, Loader2, UtensilsCrossed } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../hooks/useSession";
import { StripePaymentSection } from "./StripePaymentSection";

type PendingProposal = {
	proposalId: Id<"substitutionProposals">;
	orderId: Id<"orders">;
	dailyOrderNumber: number | null;
	orderItemId: Id<"orderItems">;
	originalName: string;
	originalLineTotal: number;
	quantity: number;
	proposedName: string;
	proposedLineTotal: number;
	deltaAmount: number;
	feeOnDelta: number;
	createdAt: number;
};

type PromptPhase =
	| { kind: "decide" }
	| { kind: "confirm-decline" }
	| { kind: "payment"; clientSecret: string };

export function SubstitutionPrompt() {
	const sessionId = useSessionStore((s) => s.sessionId);
	const { data: pending = [] } = useQuery(
		convexQuery(api.substitutions.getPendingForSession, sessionId ? { sessionId } : "skip")
	);

	// One-tap / Elements success interstitial. Kept outside the per-proposal
	// state because the proposal leaves the pending list the moment the webhook
	// accepts it — the success card must outlive it.
	const [completed, setCompleted] = useState<{ amountLabel: string } | null>(null);
	// Set while the Elements sheet is mounted for a proposal; when the webhook
	// applies the swap the proposal drops out of the pending list, and the
	// effect below converts the in-flight charge into the success card.
	const [chargeInFlight, setChargeInFlight] = useState<{
		proposalId: Id<"substitutionProposals">;
		amountLabel: string;
	} | null>(null);

	const proposals = pending as PendingProposal[];
	const active = proposals[0] ?? null;

	const inFlightSettled =
		chargeInFlight !== null && !proposals.some((p) => p.proposalId === chargeInFlight.proposalId);
	useEffect(() => {
		if (inFlightSettled && chargeInFlight) {
			setCompleted({ amountLabel: chargeInFlight.amountLabel });
			setChargeInFlight(null);
		}
	}, [inFlightSettled, chargeInFlight]);

	if (completed) {
		return (
			<SubstitutionSuccessCard
				amountLabel={completed.amountLabel}
				onDone={() => setCompleted(null)}
			/>
		);
	}
	if (!active) return null;

	return (
		<SubstitutionModal
			// Reset the internal phase whenever the surfaced proposal changes.
			key={active.proposalId}
			proposal={active}
			onCharged={(amountLabel) => setCompleted({ amountLabel })}
			onPaymentSheetMounted={(amountLabel) =>
				setChargeInFlight({ proposalId: active.proposalId, amountLabel })
			}
		/>
	);
}

function SubstitutionModal({
	proposal,
	onCharged,
	onPaymentSheetMounted,
}: Readonly<{
	proposal: PendingProposal;
	onCharged: (amountLabel: string) => void;
	onPaymentSheetMounted: (amountLabel: string) => void;
}>) {
	const { t } = useTranslation();
	const acceptProposal = useConvexMutation(api.substitutions.acceptProposal);
	const declineProposal = useConvexMutation(api.substitutions.declineProposal);
	const createSubstitutionPaymentIntent = useConvexAction(
		api.stripe.createSubstitutionPaymentIntent
	);

	const [phase, setPhase] = useState<PromptPhase>({ kind: "decide" });
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const totalExtra = proposal.deltaAmount + proposal.feeOnDelta;
	const totalExtraLabel = `$${formatCents(totalExtra)}`;

	const handleAccept = async () => {
		setBusy(true);
		setError(null);
		try {
			if (proposal.deltaAmount === 0) {
				await acceptProposal({ proposalId: proposal.proposalId });
				// The subscription drops the proposal; the modal closes itself.
				return;
			}
			const result = await createSubstitutionPaymentIntent({
				proposalId: proposal.proposalId,
			});
			if (result?.clientSecret) {
				setPhase({ kind: "payment", clientSecret: result.clientSecret });
				// The webhook applying the swap drops the proposal from the pending
				// list; the parent then shows the success card in this modal's place.
				onPaymentSheetMounted(totalExtraLabel);
			} else {
				// One-tap on the saved card went through; the webhook is applying
				// the swap.
				onCharged(totalExtraLabel);
			}
		} catch (err) {
			setError(getErrorMessage(err, t, OrderingKeys.CHECKOUT_GENERIC_ERROR));
		} finally {
			setBusy(false);
		}
	};

	const handleDecline = async () => {
		setBusy(true);
		setError(null);
		try {
			await declineProposal({ proposalId: proposal.proposalId });
			// The line is 86'd and refunded server-side; the subscription closes
			// the modal.
		} catch (err) {
			setError(getErrorMessage(err, t, OrderingKeys.CHECKOUT_GENERIC_ERROR));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
			<div className="w-full max-w-md rounded-2xl bg-card border border-border p-5 space-y-4 overflow-y-auto max-h-[90vh]">
				<div className="flex items-start gap-3">
					<div className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center bg-muted">
						<UtensilsCrossed size={20} className="text-foreground" />
					</div>
					<div className="min-w-0">
						<h2 className="text-base font-bold text-foreground">{t(OrderingKeys.SUB_TITLE)}</h2>
						<p className="text-sm text-muted-foreground">
							{proposal.dailyOrderNumber !== null
								? t(OrderingKeys.SUB_BODY, {
										n: proposal.dailyOrderNumber,
										original: proposal.originalName,
									})
								: t(OrderingKeys.SUB_BODY_NO_NUMBER, { original: proposal.originalName })}
						</p>
					</div>
				</div>

				{/* Original vs proposed, with prices */}
				<div className="rounded-xl bg-muted border border-border p-4 space-y-2 text-sm">
					<div className="flex justify-between gap-2 text-muted-foreground">
						<span className="min-w-0 truncate">
							{t(OrderingKeys.SUB_ORIGINAL_LABEL)}: {proposal.quantity}x {proposal.originalName}
						</span>
						<span className="shrink-0 line-through">
							${formatCents(proposal.originalLineTotal)}
						</span>
					</div>
					<div className="flex justify-between gap-2 font-medium text-foreground">
						<span className="min-w-0 truncate">
							{t(OrderingKeys.SUB_PROPOSED_LABEL)}: {proposal.quantity}x {proposal.proposedName}
						</span>
						<span className="shrink-0">${formatCents(proposal.proposedLineTotal)}</span>
					</div>

					{proposal.deltaAmount === 0 ? (
						<p className="pt-2 border-t border-border text-sm font-medium text-foreground">
							{t(OrderingKeys.SUB_NO_EXTRA)}
						</p>
					) : (
						<div className="pt-2 border-t border-border space-y-1 text-muted-foreground">
							<div className="flex justify-between">
								<span>{t(OrderingKeys.SUB_DELTA_LINE)}</span>
								<span>${formatCents(proposal.deltaAmount)}</span>
							</div>
							<div className="flex justify-between">
								<span>{t(OrderingKeys.SUB_FEE_LINE)}</span>
								<span>${formatCents(proposal.feeOnDelta)}</span>
							</div>
							<div className="flex justify-between font-semibold text-foreground">
								<span>{t(OrderingKeys.SUB_TOTAL_EXTRA)}</span>
								<span>{totalExtraLabel}</span>
							</div>
						</div>
					)}
				</div>

				{error && (
					<div className="px-4 py-3 rounded-lg text-sm text-destructive bg-destructive-subtle">
						{error}
					</div>
				)}

				{phase.kind === "decide" && (
					<div className="space-y-2">
						<button
							type="button"
							onClick={handleAccept}
							disabled={busy}
							className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold hover-btn-primary disabled:opacity-50"
						>
							{busy ? <Loader2 size={16} className="animate-spin" /> : t(OrderingKeys.SUB_ACCEPT)}
						</button>
						<button
							type="button"
							onClick={() => setPhase({ kind: "confirm-decline" })}
							disabled={busy}
							className="w-full py-2.5 rounded-xl text-sm font-medium border border-border text-foreground hover:bg-(--bg-hover) disabled:opacity-50"
						>
							{t(OrderingKeys.SUB_DECLINE)}
						</button>
					</div>
				)}

				{phase.kind === "confirm-decline" && (
					<div className="space-y-2">
						<p className="text-sm font-medium text-foreground">
							{t(OrderingKeys.SUB_DECLINE_CONFIRM_TITLE)}
						</p>
						<p className="text-sm text-muted-foreground">
							{t(OrderingKeys.SUB_DECLINE_CONFIRM_BODY, {
								original: proposal.originalName,
								amount: `$${formatCents(
									proposal.originalLineTotal +
										Math.round(proposal.originalLineTotal * PLATFORM_APPLICATION_FEE_RATE)
								)}`,
							})}
						</p>
						<button
							type="button"
							onClick={handleDecline}
							disabled={busy}
							className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-destructive disabled:opacity-60"
							style={{ color: "white" }}
						>
							{busy ? (
								<Loader2 size={16} className="animate-spin" />
							) : (
								t(OrderingKeys.SUB_DECLINE_CONFIRM)
							)}
						</button>
						<button
							type="button"
							onClick={() => setPhase({ kind: "decide" })}
							disabled={busy}
							className="w-full py-2.5 rounded-xl text-sm font-medium border border-border text-muted-foreground disabled:opacity-50"
						>
							{t(OrderingKeys.SUB_BACK)}
						</button>
					</div>
				)}

				{phase.kind === "payment" && (
					<div className="space-y-3">
						<p className="text-sm font-medium text-foreground">
							{t(OrderingKeys.SUB_PAYMENT_TITLE)}
						</p>
						<StripePaymentSection
							clientSecret={phase.clientSecret}
							submitLabel={`${t(OrderingKeys.CHECKOUT_PAY_NOW)} · ${totalExtraLabel}`}
						/>
					</div>
				)}
			</div>
		</div>
	);
}

function SubstitutionSuccessCard({
	amountLabel,
	onDone,
}: Readonly<{ amountLabel: string; onDone: () => void }>) {
	const { t } = useTranslation();
	return (
		<div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
			<div className="w-full max-w-md rounded-2xl bg-card border border-border p-6 space-y-4 text-center">
				<div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center bg-success-subtle">
					<CheckCircle2 size={24} style={{ color: "var(--accent-success)" }} />
				</div>
				<p className="text-sm text-foreground">
					{t(OrderingKeys.SUB_ONE_TAP_SUCCESS, { amount: amountLabel })}
				</p>
				<button
					type="button"
					onClick={onDone}
					className="px-6 py-2.5 rounded-xl text-sm font-medium hover-btn-primary"
				>
					{t(OrderingKeys.SUB_DONE)}
				</button>
			</div>
		</div>
	);
}
