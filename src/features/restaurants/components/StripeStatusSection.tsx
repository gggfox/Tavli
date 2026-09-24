import { RestaurantsKeys } from "@/global/i18n";
import { SettingsRow } from "@/features/restaurants/components/settings/SettingsRow";
import { AlertCircle, Ban, CheckCircle2, Clock, ExternalLink, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
	PLATFORM_APPLICATION_FEE_RATE,
	STRIPE_ACCOUNT_STATUS,
	type StripeAccountStatus,
} from "convex/constants";
import { ResetStripeControl } from "./ResetStripeControl";

const PLATFORM_FEE_PERCENT = PLATFORM_APPLICATION_FEE_RATE * 100;

/**
 * V2 account status shape returned by the getAccountStatus action.
 * - connected: a Stripe account exists
 * - readyToReceivePayments: stripe_transfers capability is active
 * - onboardingComplete: no outstanding currently_due/past_due requirements
 * - requirementsStatus: raw status string from Stripe (null if none)
 * - accountStatus: the stored lifecycle status (TAVLI-65), `null` when there
 *   is no connected account. This is the only field that tells a **closed**
 *   account from a restaurant that was never onboarded — every other field
 *   reads the same for both, which is why a closure used to render as "not set
 *   up" with a setup button that could not work.
 */
export interface AccountStatus {
	connected: boolean;
	readyToReceivePayments: boolean;
	onboardingComplete: boolean;
	requirementsStatus: string | null;
	accountStatus?: StripeAccountStatus | null;
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
 *
 * Each state is one settings row — the state and its actions together — so it
 * sits inside the Payment Setup card like any other setting.
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
	// No Stripe-specific "Status" key yet; the billing one reads the same in both locales.
	const statusLabel = t(RestaurantsKeys.STRIPE_STATUS_LABEL);
	if (isFullySetUp) {
		return (
			<SettingsRow label={statusLabel} testId="stripe-status-row">
				<span
					className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-success"
					style={{ color: "white" }}
				>
					<CheckCircle2 size={12} />
					{t(RestaurantsKeys.STRIPE_PAYMENTS_ENABLED)}
				</span>
				<p className="mt-2 text-xs text-muted-foreground">
					{t(RestaurantsKeys.STRIPE_FULLY_SETUP)}
				</p>
				<div className="mt-3 flex flex-wrap items-center gap-2">
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
			</SettingsRow>
		);
	}

	// Stripe closed the account (TAVLI-65). There is no onboarding link that can
	// revive it, so the only offer here is the Reset — which closes nothing (it
	// is already closed) and unlinks, freeing the restaurant to onboard a new
	// account. Rendering the "not set up" branch instead, as this did before,
	// handed the operator a setup button that fails and no explanation.
	if (status?.accountStatus === STRIPE_ACCOUNT_STATUS.CLOSED) {
		return (
			<SettingsRow label={statusLabel} testId="stripe-status-row">
				<div className="space-y-3">
					<div
						className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs text-destructive"
						style={{ backgroundColor: "rgba(220, 38, 38, 0.1)" }}
						data-testid="stripe-account-closed"
					>
						<Ban size={14} className="mt-0.5 shrink-0" />
						<span>{t(RestaurantsKeys.STRIPE_ACCOUNT_CLOSED)}</span>
					</div>
					<div className="flex flex-wrap items-center gap-2">
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
			</SettingsRow>
		);
	}

	if (status?.connected) {
		return (
			<SettingsRow label={statusLabel} testId="stripe-status-row">
				<div className="space-y-3">
					{/* Show detailed status for partially-onboarded accounts */}
					<div className="space-y-2">
						{status.accountStatus === STRIPE_ACCOUNT_STATUS.RESTRICTED && (
							<div
								className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs text-warning"
								style={{ backgroundColor: "rgba(217, 119, 6, 0.1)" }}
								data-testid="stripe-account-restricted"
							>
								<AlertCircle size={14} className="mt-0.5 shrink-0" />
								<span>{t(RestaurantsKeys.STRIPE_ACCOUNT_RESTRICTED)}</span>
							</div>
						)}

						{status.requirementsStatus && (
							<div
								className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-warning"
								style={{ backgroundColor: "rgba(217, 119, 6, 0.1)" }}
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
								style={{ backgroundColor: "rgba(217, 119, 6, 0.1)" }}
							>
								<AlertCircle size={14} />
								{t(RestaurantsKeys.STRIPE_TRANSFERS_INACTIVE)}
							</div>
						)}

						{status.readyToReceivePayments && !status.onboardingComplete && (
							<div
								className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-warning"
								style={{ backgroundColor: "rgba(217, 119, 6, 0.1)" }}
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
			</SettingsRow>
		);
	}

	return (
		<SettingsRow label={statusLabel} testId="stripe-status-row">
			<div className="space-y-3">
				<p className="text-xs text-muted-foreground">
					{t(RestaurantsKeys.STRIPE_INTRO, { rate: PLATFORM_FEE_PERCENT })}
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
		</SettingsRow>
	);
}
