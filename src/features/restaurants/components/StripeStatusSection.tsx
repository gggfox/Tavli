import { RestaurantsKeys } from "@/global/i18n";
import { AlertCircle, Clock, ExternalLink, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ResetStripeControl } from "./ResetStripeControl";

/**
 * V2 account status shape returned by the getAccountStatus action.
 * - connected: a Stripe account exists
 * - readyToReceivePayments: stripe_transfers capability is active
 * - onboardingComplete: no outstanding currently_due/past_due requirements
 * - requirementsStatus: raw status string from Stripe (null if none)
 */
export interface AccountStatus {
	connected: boolean;
	readyToReceivePayments: boolean;
	onboardingComplete: boolean;
	requirementsStatus: string | null;
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
export function StripeStatusSection({
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
