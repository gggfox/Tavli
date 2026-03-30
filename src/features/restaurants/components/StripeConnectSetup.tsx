import { useConvexAction } from "@convex-dev/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { AlertCircle, CheckCircle2, Clock, ExternalLink, Loader2 } from "lucide-react";
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

	const [status, setStatus] = useState<AccountStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [actionLoading, setActionLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

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

			<StripeStatusSection
				status={status}
				isFullySetUp={!!isFullySetUp}
				actionLoading={actionLoading}
				onSetup={handleSetup}
				onRefresh={refreshStatus}
			/>
		</div>
	);
}

/**
 * Renders the appropriate status section based on the V2 account state:
 * 1. Fully active — shows dashboard link and status
 * 2. Connected but incomplete — shows requirements status and continue button
 * 3. Not connected — shows setup button
 */
function StripeStatusSection({
	status,
	isFullySetUp,
	actionLoading,
	onSetup,
	onRefresh,
}: Readonly<{
	status: AccountStatus | null;
	isFullySetUp: boolean;
	actionLoading: boolean;
	onSetup: () => void;
	onRefresh: () => void;
}>) {
	if (isFullySetUp) {
		return (
			<div className="space-y-3">
				<p className="text-xs" style={{ color: "var(--text-secondary)" }}>
					Your Stripe account is connected and ready to receive payments. Customers will be charged
					when placing orders, and funds will be transferred to your Stripe account automatically.
				</p>
				<div className="flex items-center gap-2">
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

				<div className="flex items-center gap-2">
					<button
						onClick={onSetup}
						disabled={actionLoading}
						className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
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
