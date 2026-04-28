import { useConvexAction } from "@convex-dev/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import {
	AlertCircle,
	AlertTriangle,
	CheckCircle2,
	Clock,
	ExternalLink,
	Loader2,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * V2 account status shape returned by the getAccountStatus action.
 * - connected: a Stripe account exists
 * - readyToReceivePayments: stripe_transfers capability is active
 * - onboardingComplete: no outstanding currently_due/past_due requirements
 * - requirementsStatus: raw status string from Stripe (null if none)
 */
interface AccountStatus {
	connected: boolean;
	readyToReceivePayments: boolean;
	onboardingComplete: boolean;
	requirementsStatus: string | null;
}

interface StripeConnectSetupProps {
	restaurantId: Id<"restaurants">;
}

/**
 * Admin component for managing Stripe Connect onboarding for a restaurant.
 *
 * Shows the current V2 account status and provides actions to:
 * - Create a new Connected Account (if not connected)
 * - Start/continue the onboarding flow via Account Links
 * - View the current requirements and capability status
 *
 * Status is always fetched from the Stripe API directly (not cached in DB)
 * to ensure the UI reflects the latest state.
 */
export function StripeConnectSetup({ restaurantId }: Readonly<StripeConnectSetupProps>) {
	const createAccount = useConvexAction(api.stripe.createConnectAccount);
	const createLink = useConvexAction(api.stripe.createAccountLink);
	const checkStatus = useConvexAction(api.stripe.getAccountStatus);
	const resetConnection = useConvexAction(api.stripe.resetStripeConnection);

	const [status, setStatus] = useState<AccountStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [actionLoading, setActionLoading] = useState(false);
	const [resetLoading, setResetLoading] = useState(false);
	const [confirmingReset, setConfirmingReset] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [resetNotice, setResetNotice] = useState<string | null>(null);

	const refreshStatus = useCallback(async () => {
		try {
			setLoading(true);
			const result = await checkStatus({ restaurantId });
			setStatus(result);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to check payment status");
		} finally {
			setLoading(false);
		}
	}, [checkStatus, restaurantId]);

	useEffect(() => {
		refreshStatus();
	}, [refreshStatus]);

	// Handle return from Stripe onboarding: refresh status and clean up URL
	useEffect(() => {
		const params = new URLSearchParams(globalThis.location.search);
		if (params.get("stripe_return") === "true" || params.get("accountId")) {
			refreshStatus();
			const url = new URL(globalThis.location.href);
			url.searchParams.delete("stripe_return");
			url.searchParams.delete("accountId");
			globalThis.history.replaceState({}, "", url.toString());
		}
	}, [refreshStatus]);

	const handleSetup = async () => {
		setError(null);
		setResetNotice(null);
		setActionLoading(true);
		try {
			if (!status?.connected) {
				await createAccount({ restaurantId });
			}

			const returnUrl = `${globalThis.location.origin}${globalThis.location.pathname}?stripe_return=true`;
			const refreshUrl = `${globalThis.location.origin}${globalThis.location.pathname}`;

			const linkResult = await createLink({
				restaurantId,
				returnUrl,
				refreshUrl,
			});

			globalThis.location.href = linkResult.url;
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to start Stripe setup");
			setActionLoading(false);
		}
	};

	const handleReset = async () => {
		setError(null);
		setResetNotice(null);
		setResetLoading(true);
		try {
			const result = await resetConnection({ restaurantId });
			setConfirmingReset(false);
			setResetNotice(
				result.closedStripeAccount
					? `Disconnected and closed Stripe account ${result.closedStripeAccountId}. You can now onboard a new account.`
					: "Disconnected from Stripe. The previous account was left open — close it from your Stripe Dashboard if needed."
			);
			await refreshStatus();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to reset Stripe setup");
		} finally {
			setResetLoading(false);
		}
	};

	if (loading) {
		return (
			<div
				className="rounded-xl p-6"
				style={{
					backgroundColor: "var(--bg-secondary)",
					border: "1px solid var(--border-default)",
				}}
			>
				<div className="flex items-center gap-2">
					<Loader2 size={16} className="animate-spin" style={{ color: "var(--text-muted)" }} />
					<span className="text-sm" style={{ color: "var(--text-muted)" }}>
						Checking payment setup...
					</span>
				</div>
			</div>
		);
	}

	const isFullySetUp =
		status?.connected && status.readyToReceivePayments && status.onboardingComplete;

	return (
		<div
			className="rounded-xl p-6 space-y-4"
			style={{
				backgroundColor: "var(--bg-secondary)",
				border: "1px solid var(--border-default)",
			}}
		>
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
						Payment Setup
					</h3>
					<p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
						Connect your Stripe account to accept customer payments.
					</p>
				</div>
				{isFullySetUp && (
					<span
						className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
						style={{ backgroundColor: "var(--accent-success)", color: "white" }}
					>
						<CheckCircle2 size={12} />
						Payments Enabled
					</span>
				)}
			</div>

			{error && (
				<div
					className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
					style={{
						backgroundColor: "rgba(220, 38, 38, 0.1)",
						color: "var(--accent-danger, #dc2626)",
					}}
				>
					<AlertCircle size={14} />
					{error}
				</div>
			)}

			{resetNotice && (
				<div
					className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs"
					style={{
						backgroundColor: "rgba(34, 197, 94, 0.1)",
						color: "var(--accent-success, #16a34a)",
					}}
				>
					<CheckCircle2 size={14} className="mt-0.5 shrink-0" />
					<span>{resetNotice}</span>
				</div>
			)}

			<StripeStatusSection
				status={status}
				isFullySetUp={!!isFullySetUp}
				actionLoading={actionLoading}
				resetLoading={resetLoading}
				confirmingReset={confirmingReset}
				onSetup={handleSetup}
				onRefresh={refreshStatus}
				onRequestReset={() => setConfirmingReset(true)}
				onCancelReset={() => setConfirmingReset(false)}
				onConfirmReset={handleReset}
			/>
		</div>
	);
}

interface StripeStatusSectionProps {
	status: AccountStatus | null;
	isFullySetUp: boolean;
	actionLoading: boolean;
	resetLoading: boolean;
	confirmingReset: boolean;
	onSetup: () => void;
	onRefresh: () => void;
	onRequestReset: () => void;
	onCancelReset: () => void;
	onConfirmReset: () => void;
}

/**
 * Renders the appropriate status section based on the V2 account state:
 * 1. Fully active — shows dashboard link and status
 * 2. Connected but incomplete — shows requirements status and continue button
 * 3. Not connected — shows setup button
 *
 * Once an account exists (cases 1 and 2) a "Reset Stripe Setup" control is
 * available so the user can unlink it — necessary when they need to re-onboard
 * with different parameters (e.g. a different country) since Stripe locks the
 * account country after creation.
 */
function StripeStatusSection({
	status,
	isFullySetUp,
	actionLoading,
	resetLoading,
	confirmingReset,
	onSetup,
	onRefresh,
	onRequestReset,
	onCancelReset,
	onConfirmReset,
}: Readonly<StripeStatusSectionProps>) {
	if (isFullySetUp) {
		return (
			<div className="space-y-3">
				<p className="text-xs" style={{ color: "var(--text-secondary)" }}>
					Your Stripe account is connected and ready to receive payments. Customers will be charged
					when placing orders, and funds will be transferred to your Stripe account automatically.
				</p>
				<div className="flex flex-wrap items-center gap-2">
					<a
						href="https://dashboard.stripe.com/"
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-(--bg-hover)"
						style={{
							color: "var(--accent-primary)",
							border: "1px solid var(--border-default)",
						}}
					>
						<ExternalLink size={12} />
						Stripe Dashboard
					</a>
					<button
						onClick={onRefresh}
						className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-(--bg-hover)"
						style={{
							color: "var(--text-secondary)",
							border: "1px solid var(--border-default)",
						}}
					>
						Refresh Status
					</button>
					<ResetStripeControl
						confirmingReset={confirmingReset}
						resetLoading={resetLoading}
						onRequestReset={onRequestReset}
						onCancelReset={onCancelReset}
						onConfirmReset={onConfirmReset}
					/>
				</div>
			</div>
		);
	}

	if (status?.connected) {
		return (
			<div className="space-y-3">
				{/* Show detailed status for partially-onboarded accounts */}
				<div className="space-y-2">
					{status.requirementsStatus && (
						<div
							className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
							style={{
								backgroundColor: "rgba(217, 119, 6, 0.1)",
								color: "var(--accent-warning, #d97706)",
							}}
						>
							<Clock size={14} />
							<span>
								Requirements status: <strong>{status.requirementsStatus}</strong>
								{status.requirementsStatus === "currently_due" &&
									" — Action needed to complete onboarding."}
								{status.requirementsStatus === "past_due" &&
									" — Overdue requirements must be completed immediately."}
							</span>
						</div>
					)}

					{!status.readyToReceivePayments && (
						<div
							className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
							style={{
								backgroundColor: "rgba(217, 119, 6, 0.1)",
								color: "var(--accent-warning, #d97706)",
							}}
						>
							<AlertCircle size={14} />
							Payment transfers are not yet active. Complete onboarding to enable payments.
						</div>
					)}

					{status.readyToReceivePayments && !status.onboardingComplete && (
						<div
							className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
							style={{
								backgroundColor: "rgba(217, 119, 6, 0.1)",
								color: "var(--accent-warning, #d97706)",
							}}
						>
							<AlertCircle size={14} />
							Payments are enabled but additional requirements need attention.
						</div>
					)}
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<button
						onClick={onSetup}
						disabled={actionLoading || resetLoading || confirmingReset}
						className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary disabled:opacity-50"
					>
						{actionLoading ? (
							<>
								<Loader2 size={14} className="animate-spin" />
								Redirecting...
							</>
						) : (
							<>
								<ExternalLink size={14} />
								Continue Stripe Setup
							</>
						)}
					</button>
					<button
						onClick={onRefresh}
						className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-(--bg-hover)"
						style={{
							color: "var(--text-secondary)",
							border: "1px solid var(--border-default)",
						}}
					>
						Refresh
					</button>
					<ResetStripeControl
						confirmingReset={confirmingReset}
						resetLoading={resetLoading}
						onRequestReset={onRequestReset}
						onCancelReset={onCancelReset}
						onConfirmReset={onConfirmReset}
					/>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			<p className="text-xs" style={{ color: "var(--text-secondary)" }}>
				Set up Stripe to accept credit card payments from customers. A 6% platform fee applies on
				top of Stripe&apos;s standard processing fees.
			</p>
			<button
				onClick={onSetup}
				disabled={actionLoading}
				className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
			>
				{actionLoading ? (
					<>
						<Loader2 size={14} className="animate-spin" />
						Setting up...
					</>
				) : (
					"Onboard to collect payments"
				)}
			</button>
		</div>
	);
}

/**
 * Two-step confirmation control for disconnecting the restaurant from its
 * Stripe account. Collapsed state renders a small danger-tinted button; the
 * expanded state renders a warning with explicit Confirm/Cancel actions.
 */
function ResetStripeControl({
	confirmingReset,
	resetLoading,
	onRequestReset,
	onCancelReset,
	onConfirmReset,
}: Readonly<{
	confirmingReset: boolean;
	resetLoading: boolean;
	onRequestReset: () => void;
	onCancelReset: () => void;
	onConfirmReset: () => void;
}>) {
	if (!confirmingReset) {
		return (
			<button
				type="button"
				onClick={onRequestReset}
				disabled={resetLoading}
				className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-(--bg-hover) disabled:opacity-50"
				style={{
					color: "var(--accent-danger, #dc2626)",
					border: "1px solid var(--border-default)",
				}}
				data-testid="stripe-reset-button"
			>
				<Trash2 size={12} />
				Reset Stripe Setup
			</button>
		);
	}

	return (
		<div
			className="flex flex-col gap-2 w-full p-3 rounded-lg"
			style={{
				backgroundColor: "rgba(220, 38, 38, 0.08)",
				border: "1px solid rgba(220, 38, 38, 0.3)",
			}}
			data-testid="stripe-reset-confirm"
		>
			<div className="flex items-start gap-2 text-xs" style={{ color: "var(--text-primary)" }}>
				<AlertTriangle
					size={14}
					className="mt-0.5 shrink-0"
					style={{ color: "var(--accent-danger, #dc2626)" }}
				/>
				<span>
					This closes the current Stripe account and unlinks it from this restaurant. You&apos;ll
					need to complete onboarding again. Any existing products tied to this account will no
					longer be chargeable.
				</span>
			</div>
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={onConfirmReset}
					disabled={resetLoading}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
					style={{ backgroundColor: "var(--accent-danger, #dc2626)", color: "#fff" }}
					data-testid="stripe-reset-confirm-button"
				>
					{resetLoading ? (
						<>
							<Loader2 size={12} className="animate-spin" />
							Resetting...
						</>
					) : (
						<>
							<Trash2 size={12} />
							Confirm Reset
						</>
					)}
				</button>
				<button
					type="button"
					onClick={onCancelReset}
					disabled={resetLoading}
					className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-(--bg-hover) disabled:opacity-50"
					style={{
						color: "var(--text-secondary)",
						border: "1px solid var(--border-default)",
					}}
				>
					Cancel
				</button>
			</div>
		</div>
	);
}
