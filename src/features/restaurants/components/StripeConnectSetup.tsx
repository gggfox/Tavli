import { RestaurantsKeys } from "@/global/i18n";
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
import { useTranslation } from "react-i18next";

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
	const { t } = useTranslation();
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
			setError(err instanceof Error ? err.message : t(RestaurantsKeys.STRIPE_STATUS_FAILED));
		} finally {
			setLoading(false);
		}
	}, [checkStatus, restaurantId, t]);

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
			setError(err instanceof Error ? err.message : t(RestaurantsKeys.STRIPE_SETUP_FAILED));
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
					? t(RestaurantsKeys.STRIPE_DISCONNECTED_CLOSED, {
							accountId: result.closedStripeAccountId,
						})
					: t(RestaurantsKeys.STRIPE_DISCONNECTED_LEFT_OPEN)
			);
			await refreshStatus();
		} catch (err) {
			setError(err instanceof Error ? err.message : t(RestaurantsKeys.STRIPE_RESET_FAILED));
		} finally {
			setResetLoading(false);
		}
	};

	if (loading) {
		return (
			<div
				className="rounded-xl p-6 bg-muted border border-border"
				
			>
				<div className="flex items-center gap-2">
					<Loader2 size={16} className="animate-spin text-faint-foreground"  />
					<span className="text-sm text-faint-foreground" >
						{t(RestaurantsKeys.STRIPE_CHECKING)}
					</span>
				</div>
			</div>
		);
	}

	const isFullySetUp =
		status?.connected && status.readyToReceivePayments && status.onboardingComplete;

	return (
		<div
			className="rounded-xl p-6 space-y-4 bg-muted border border-border"
			
		>
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-sm font-semibold text-foreground" >
						{t(RestaurantsKeys.STRIPE_HEADING)}
					</h3>
					<p className="text-xs mt-0.5 text-faint-foreground" >
						{t(RestaurantsKeys.STRIPE_DESCRIPTION)}
					</p>
				</div>
				{isFullySetUp && (
					<span
						className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-success"
						style={{color: "white"}}
					>
						<CheckCircle2 size={12} />
						{t(RestaurantsKeys.STRIPE_PAYMENTS_ENABLED)}
					</span>
				)}
			</div>

			{error && (
				<div
					className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-destructive"
					style={{backgroundColor: "rgba(220, 38, 38, 0.1)"}}
				>
					<AlertCircle size={14} />
					{error}
				</div>
			)}

			{resetNotice && (
				<div
					className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs text-success"
					style={{backgroundColor: "rgba(34, 197, 94, 0.1)"}}
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
	const { t } = useTranslation();
	if (isFullySetUp) {
		return (
			<div className="space-y-3">
				<p className="text-xs text-muted-foreground" >
					{t(RestaurantsKeys.STRIPE_FULLY_SETUP)}
				</p>
				<div className="flex flex-wrap items-center gap-2">
					<a
						href="https://dashboard.stripe.com/"
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-(--bg-hover) text-accent border border-border"
						
					>
						<ExternalLink size={12} />
						{t(RestaurantsKeys.STRIPE_DASHBOARD)}
					</a>
					<button
						onClick={onRefresh}
						className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-(--bg-hover) text-muted-foreground border border-border"
						
					>
						{t(RestaurantsKeys.STRIPE_REFRESH_STATUS)}
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
							className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-warning"
							style={{backgroundColor: "rgba(217, 119, 6, 0.1)"}}
						>
							<Clock size={14} />
							<span>
								{t(RestaurantsKeys.STRIPE_REQUIREMENTS_PREFIX)}{" "}
								<strong>{status.requirementsStatus}</strong>
								{status.requirementsStatus === "currently_due" &&
									t(RestaurantsKeys.STRIPE_REQ_CURRENTLY_DUE)}
								{status.requirementsStatus === "past_due" &&
									t(RestaurantsKeys.STRIPE_REQ_PAST_DUE)}
							</span>
						</div>
					)}

					{!status.readyToReceivePayments && (
						<div
							className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-warning"
							style={{backgroundColor: "rgba(217, 119, 6, 0.1)"}}
						>
							<AlertCircle size={14} />
							{t(RestaurantsKeys.STRIPE_TRANSFERS_INACTIVE)}
						</div>
					)}

					{status.readyToReceivePayments && !status.onboardingComplete && (
						<div
							className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-warning"
							style={{backgroundColor: "rgba(217, 119, 6, 0.1)"}}
						>
							<AlertCircle size={14} />
							{t(RestaurantsKeys.STRIPE_PARTIAL_REQ)}
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
								{t(RestaurantsKeys.STRIPE_REDIRECTING)}
							</>
						) : (
							<>
								<ExternalLink size={14} />
								{t(RestaurantsKeys.STRIPE_CONTINUE_SETUP)}
							</>
						)}
					</button>
					<button
						onClick={onRefresh}
						className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-(--bg-hover) text-muted-foreground border border-border"
						
					>
						{t(RestaurantsKeys.STRIPE_REFRESH)}
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
			<p className="text-xs text-muted-foreground" >
				{t(RestaurantsKeys.STRIPE_INTRO)}
			</p>
			<button
				onClick={onSetup}
				disabled={actionLoading}
				className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
			>
				{actionLoading ? (
					<>
						<Loader2 size={14} className="animate-spin" />
						{t(RestaurantsKeys.STRIPE_SETTING_UP)}
					</>
				) : (
					t(RestaurantsKeys.STRIPE_ONBOARD)
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
	const { t } = useTranslation();
	if (!confirmingReset) {
		return (
			<button
				type="button"
				onClick={onRequestReset}
				disabled={resetLoading}
				className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-(--bg-hover) disabled:opacity-50 border border-border text-destructive"
				
				data-testid="stripe-reset-button"
			>
				<Trash2 size={12} />
				{t(RestaurantsKeys.STRIPE_RESET_BUTTON)}
			</button>
		);
	}

	return (
		<div
			className="flex flex-col gap-2 w-full p-3 rounded-lg"
			style={{backgroundColor: "rgba(220, 38, 38, 0.08)",
				border: "1px solid rgba(220, 38, 38, 0.3)"}}
			data-testid="stripe-reset-confirm"
		>
			<div className="flex items-start gap-2 text-xs text-foreground" >
				<AlertTriangle
					size={14}
					className="mt-0.5 shrink-0 text-destructive"
					
				/>
				<span>{t(RestaurantsKeys.STRIPE_RESET_WARNING)}</span>
			</div>
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={onConfirmReset}
					disabled={resetLoading}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 bg-destructive"
					style={{color: "#fff"}}
					data-testid="stripe-reset-confirm-button"
				>
					{resetLoading ? (
						<>
							<Loader2 size={12} className="animate-spin" />
							{t(RestaurantsKeys.STRIPE_RESET_RESETTING)}
						</>
					) : (
						<>
							<Trash2 size={12} />
							{t(RestaurantsKeys.STRIPE_RESET_CONFIRM)}
						</>
					)}
				</button>
				<button
					type="button"
					onClick={onCancelReset}
					disabled={resetLoading}
					className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-(--bg-hover) disabled:opacity-50 text-muted-foreground border border-border"
					
				>
					{t(RestaurantsKeys.STRIPE_RESET_CANCEL)}
				</button>
			</div>
		</div>
	);
}
