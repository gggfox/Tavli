import { SettingsSection } from "@/features/restaurants/components/settings/SettingsSection";
import { WhatsappAssistantPanel } from "@/features/whatsapp";
import { InlineError, StatusBadge } from "@/global/components";
import { WhatsappKeys } from "@/global/i18n";
import { useConvexMutation } from "@convex-dev/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
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
	const [isBusy, setIsBusy] = useState(false);

	const { data: enablement } = useQuery(
		convexQuery(api.whatsappChannels.getForRestaurant, { restaurantId })
	);
	const setEnabled = useConvexMutation(api.whatsappChannels.setEnabled);
	const regenerate = useConvexMutation(api.whatsappChannels.regenerateShortCode);

	const run = async (action: () => Promise<unknown>) => {
		setError(null);
		setIsBusy(true);
		try {
			await action();
		} catch {
			setError(t(WhatsappKeys.ASSISTANT_ACTION_FAILED));
		} finally {
			setIsBusy(false);
		}
	};

	return (
		<SettingsSection
			title={t(WhatsappKeys.ASSISTANT_TITLE)}
			hint={t(WhatsappKeys.ASSISTANT_HINT)}
			testId="settings-whatsapp-assistant"
		>
			{error ? <InlineError message={error} onDismiss={() => setError(null)} /> : null}

			{enablement ? (
				<div className="space-y-4">
					{!enablement.isActive ? (
						<StatusBadge
							bgColor="var(--bg-tertiary)"
							textColor="var(--text-muted)"
							label={t(WhatsappKeys.ASSISTANT_PAUSED)}
						/>
					) : null}

					<WhatsappAssistantPanel
						restaurantName={enablement.restaurantName}
						formattedShortCode={enablement.formattedShortCode}
						deepLinkUrl={enablement.deepLinkUrl}
						deepLinkText={enablement.deepLinkText}
					/>

					{isAdmin ? (
						<div className="space-y-2 border-t border-border pt-3">
							<div className="flex flex-wrap gap-2">
								<button
									type="button"
									disabled={isBusy}
									onClick={() =>
										run(() => setEnabled({ restaurantId, isActive: !enablement.isActive }))
									}
									className="rounded-full border border-border px-3 py-1.5 text-xs font-medium hover-secondary disabled:opacity-50"
								>
									{enablement.isActive
										? t(WhatsappKeys.ASSISTANT_PAUSE)
										: t(WhatsappKeys.ASSISTANT_ENABLE)}
								</button>
								<button
									type="button"
									disabled={isBusy}
									onClick={() => run(() => regenerate({ restaurantId }))}
									className="rounded-full border border-border px-3 py-1.5 text-xs font-medium hover-secondary disabled:opacity-50"
								>
									{t(WhatsappKeys.ASSISTANT_REGENERATE)}
								</button>
							</div>
							<p className="text-xs text-faint-foreground">
								{t(WhatsappKeys.ASSISTANT_REGENERATE_HINT)}
							</p>
						</div>
					) : null}
				</div>
			) : (
				<div className="space-y-2">
					<p className="text-xs text-faint-foreground">{t(WhatsappKeys.ASSISTANT_NOT_ENABLED)}</p>
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
				</div>
			)}
		</SettingsSection>
	);
}
