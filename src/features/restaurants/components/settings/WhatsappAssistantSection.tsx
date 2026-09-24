import { SettingsRow } from "@/features/restaurants/components/settings/SettingsRow";
import { SettingsSection } from "@/features/restaurants/components/settings/SettingsSection";
import { WhatsappAssistantPanel } from "@/features/whatsapp";
import { InlineError, StatusBadge } from "@/global/components";
import { ERROR_CODE_KEYS, WhatsappKeys } from "@/global/i18n";
import { extractErrorCode } from "@/global/utils/errorMessages";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { useConvexMutation } from "@convex-dev/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface WhatsappAssistantSectionProps {
	readonly restaurantId: Id<"restaurants">;
	/** Platform admins can enable, pause, and reissue the code. Staff cannot. */
	readonly isAdmin: boolean;
}

/**
 * The restaurant's WhatsApp assistant, in Settings (ADR 012).
 *
 * Staff see the link, the code and the QR — they are the ones who print it and
 * put it on a table. Only a platform admin sees the controls, and that split is
 * enforced on the backend, not here: enabling a restaurant spends money on
 * Tavli's own Twilio and OpenRouter accounts, and the subscription gate that
 * would make it the restaurant's cost does not exist yet (TAVLI-95).
 */
export function WhatsappAssistantSection({ restaurantId, isAdmin }: WhatsappAssistantSectionProps) {
	const { t } = useTranslation();
	const [error, setError] = useState<string | null>(null);
	// The backend refused to turn the assistant on because the restaurant is
	// inactive — the one failure with a fix we can offer right here (TAVLI-107).
	const [refusedForInactiveRestaurant, setRefusedForInactiveRestaurant] = useState(false);
	const [isBusy, setIsBusy] = useState(false);

	const { data: enablement } = useQuery(
		convexQuery(api.whatsappChannels.getForRestaurant, { restaurantId })
	);
	// Zero tables folds into "not accepting reservations" (see
	// `loadEffectiveSettings`). The assistant still answers menu questions, so
	// this is a warning with a way out, never a reason to withhold Enable.
	const { data: reservationSettings } = useQuery(
		convexQuery(api.reservationSettings.get, { restaurantId })
	);
	// Strictly `false`: warn only when the settings query has answered and said so.
	const hasNoTables = reservationSettings?.hasActiveTables === false;
	const setEnabled = useConvexMutation(api.whatsappChannels.setEnabled);
	const regenerate = useConvexMutation(api.whatsappChannels.regenerateShortCode);
	const toggleRestaurantActive = useConvexMutation(api.restaurants.toggleActive);

	// Derived, never stored: the channel row is untouched when a restaurant is
	// deactivated, so the assistant being off is read from the restaurant. A
	// reactivated restaurant gets its assistant back with no further clicks.
	const restaurantInactive = enablement ? !enablement.restaurantIsActive : false;

	const run = async (action: () => Promise<unknown>) => {
		setError(null);
		setRefusedForInactiveRestaurant(false);
		setIsBusy(true);
		try {
			await action();
		} catch (caught) {
			const code = extractErrorCode(caught);
			if (code === "ERROR_RESTAURANT_INACTIVE") {
				setError(t(ERROR_CODE_KEYS[code]));
				setRefusedForInactiveRestaurant(true);
			} else {
				setError(t(WhatsappKeys.ASSISTANT_ACTION_FAILED));
			}
		} finally {
			setIsBusy(false);
		}
	};

	// The quick action: one click, because the intent is unambiguous at that
	// moment. `toggleActive` is what the restaurants API offers; it is only
	// reachable from a state the UI has just read as inactive.
	const activateRestaurantAndEnable = () =>
		run(async () => {
			unwrapResult(await toggleRestaurantActive({ restaurantId }));
			await setEnabled({ restaurantId, isActive: true });
		});

	const activateButton = (
		<button
			type="button"
			disabled={isBusy}
			onClick={activateRestaurantAndEnable}
			className="rounded-full px-3 py-1.5 text-xs font-medium hover-btn-primary disabled:opacity-50"
		>
			{t(WhatsappKeys.ASSISTANT_ACTIVATE_RESTAURANT)}
		</button>
	);

	const toggleEnabledButton = enablement ? (
		<button
			type="button"
			disabled={isBusy}
			onClick={() => run(() => setEnabled({ restaurantId, isActive: !enablement.isActive }))}
			className="rounded-full border border-border px-3 py-1.5 text-xs font-medium hover-secondary disabled:opacity-50"
		>
			{enablement.isActive ? t(WhatsappKeys.ASSISTANT_PAUSE) : t(WhatsappKeys.ASSISTANT_ENABLE)}
		</button>
	) : null;

	// The status row carries a badge only when the assistant is off; an active
	// assistant at an active restaurant shows nothing here but the admin's Pause.
	const statusBadge = !enablement ? null : restaurantInactive ? (
		<StatusBadge
			bgColor="var(--bg-tertiary)"
			textColor="var(--text-muted)"
			label={t(WhatsappKeys.ASSISTANT_OFF_RESTAURANT_INACTIVE)}
		/>
	) : !enablement.isActive ? (
		<StatusBadge
			bgColor="var(--bg-tertiary)"
			textColor="var(--text-muted)"
			label={t(WhatsappKeys.ASSISTANT_PAUSED)}
		/>
	) : null;

	return (
		<SettingsSection
			title={t(WhatsappKeys.ASSISTANT_TITLE)}
			hint={t(WhatsappKeys.ASSISTANT_HINT)}
			testId="settings-whatsapp-assistant"
		>
			{error ? (
				<div className="mb-4 space-y-2">
					<InlineError
						message={error}
						onDismiss={() => {
							setError(null);
							setRefusedForInactiveRestaurant(false);
						}}
					/>
					{refusedForInactiveRestaurant && isAdmin ? activateButton : null}
				</div>
			) : null}

			{hasNoTables ? (
				<p
					className="mb-4 rounded-md border border-border px-3 py-2 text-xs text-faint-foreground"
					data-testid="settings-whatsapp-no-tables"
				>
					{t(WhatsappKeys.ASSISTANT_NO_TABLES_WARNING)}{" "}
					<Link
						to="/admin/restaurants"
						search={{ manage: restaurantId, settings: undefined }}
						className="font-medium underline"
					>
						{t(WhatsappKeys.ASSISTANT_NO_TABLES_LINK)}
					</Link>
				</p>
			) : null}

			{enablement ? (
				<>
					{/* Staff at an active restaurant would get an empty row — skip it. */}
					{statusBadge || isAdmin ? (
						<SettingsRow
							label={t(WhatsappKeys.ASSISTANT_STATUS_LABEL)}
							testId="settings-whatsapp-status"
						>
							<div className="flex flex-wrap items-center gap-2">
								{statusBadge}
								{isAdmin ? toggleEnabledButton : null}
								{restaurantInactive && isAdmin ? activateButton : null}
							</div>
						</SettingsRow>
					) : null}

					<SettingsRow label={t(WhatsappKeys.ASSISTANT_QR_ROW_LABEL)} testId="settings-whatsapp-qr">
						<WhatsappAssistantPanel
							restaurantName={enablement.restaurantName}
							formattedShortCode={enablement.formattedShortCode}
							deepLinkUrl={enablement.deepLinkUrl}
							deepLinkText={enablement.deepLinkText}
						/>
					</SettingsRow>

					{isAdmin ? (
						<SettingsRow
							label={t(WhatsappKeys.ASSISTANT_REGENERATE)}
							hint={t(WhatsappKeys.ASSISTANT_REGENERATE_HINT)}
							testId="settings-whatsapp-regenerate"
						>
							<button
								type="button"
								disabled={isBusy}
								onClick={() => run(() => regenerate({ restaurantId }))}
								className="rounded-full border border-border px-3 py-1.5 text-xs font-medium hover-secondary disabled:opacity-50"
							>
								{t(WhatsappKeys.ASSISTANT_REGENERATE)}
							</button>
						</SettingsRow>
					) : null}
				</>
			) : (
				<SettingsRow
					label={t(WhatsappKeys.ASSISTANT_STATUS_LABEL)}
					hint={t(WhatsappKeys.ASSISTANT_NOT_ENABLED)}
					testId="settings-whatsapp-status"
				>
					{isAdmin ? (
						<button
							type="button"
							disabled={isBusy}
							onClick={() => run(() => setEnabled({ restaurantId, isActive: true }))}
							className="rounded-full px-3 py-1.5 text-xs font-medium hover-btn-primary disabled:opacity-50"
						>
							{t(WhatsappKeys.ASSISTANT_ENABLE)}
						</button>
					) : (
						<p className="text-xs text-faint-foreground">{t(WhatsappKeys.ASSISTANT_ADMIN_ONLY)}</p>
					)}
				</SettingsRow>
			)}
		</SettingsSection>
	);
}
