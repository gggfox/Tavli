import { RestaurantsKeys } from "@/global/i18n";
import { useConvexAction } from "@convex-dev/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StripeStatusSection, type AccountStatus } from "./StripeStatusSection";

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
