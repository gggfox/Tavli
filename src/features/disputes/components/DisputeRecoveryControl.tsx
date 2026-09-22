import { InlineError, Surface } from "@/global/components";
import { DisputesKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils";
import { getErrorMessage } from "@/global/utils/errorMessages";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type RecoverySettings = NonNullable<
	Awaited<FunctionReturnType<typeof api.disputes.getDisputeRecoverySettings>>[0]
>;

export interface DisputeRecoveryControlProps {
	readonly restaurantId: Id<"restaurants">;
}

/**
 * The platform admin's dispute-recovery percentage, in the Stripe section of
 * the admin restaurants page (TAVLI-102).
 *
 * A sibling of `StripeStatusSection` rather than a field inside it: the status
 * section is about whether the connected account can take money at all, which
 * every restaurant owner sees, while this is a **commercial term** only Tavli
 * sets. `api.disputes.getDisputeRecoverySettings` refuses a non-admin, so this
 * renders nothing at all for the restaurant's own owner rather than showing
 * them a control they cannot use.
 *
 * Zero is an explicit, first-class choice and the copy says so — it is the
 * default for every restaurant, and an admin has to be able to read "0" as
 * "recovery is off" rather than as "unset". The input's `max` is a convenience;
 * the mutation's validator is the rule, and a value above the cap comes back as
 * `ERROR_DISPUTE_RECOVERY_PERCENT_INVALID`.
 */
export function DisputeRecoveryControl({ restaurantId }: DisputeRecoveryControlProps) {
	const { t } = useTranslation();
	const [draft, setDraft] = useState<string>("");
	const [isSaving, setIsSaving] = useState(false);
	const [savedPercent, setSavedPercent] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);

	const { data: settings } = useQuery({
		...convexQuery(api.disputes.getDisputeRecoverySettings, { restaurantId }),
		select: unwrapResult<RecoverySettings>,
	});
	const setPercent = useConvexMutation(api.disputes.setDisputeRecoveryPercent);

	useEffect(() => {
		if (settings) setDraft(String(settings.percent));
	}, [settings]);

	// Refused (not a platform admin) or still loading: render nothing rather
	// than a disabled control nobody can explain.
	if (!settings) return null;

	const parsed = Number(draft);
	const isValid =
		draft.trim() !== "" && Number.isInteger(parsed) && parsed >= 0 && parsed <= settings.maxPercent;

	const handleSave = async () => {
		setError(null);
		setSavedPercent(null);
		if (!isValid) {
			setError(t(DisputesKeys.ADMIN_INVALID, { max: settings.maxPercent }));
			return;
		}
		setIsSaving(true);
		try {
			await setPercent({ restaurantId, percent: parsed });
			setSavedPercent(parsed);
		} catch (err) {
			setError(getErrorMessage(err, t, DisputesKeys.ADMIN_INVALID));
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<Surface
			tone="secondary"
			rounded="lg"
			className="p-4 space-y-3"
			data-testid="dispute-recovery-control"
		>
			<div className="space-y-1">
				<p className="text-sm font-semibold text-foreground">{t(DisputesKeys.ADMIN_TITLE)}</p>
				<p className="text-xs text-muted-foreground">
					{t(DisputesKeys.ADMIN_DESCRIPTION, { max: settings.maxPercent })}
				</p>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				<label
					htmlFor="dispute-recovery-percent"
					className="text-xs font-medium text-muted-foreground"
				>
					{t(DisputesKeys.ADMIN_LABEL)}
				</label>
				<input
					id="dispute-recovery-percent"
					type="number"
					inputMode="numeric"
					min={0}
					max={settings.maxPercent}
					step={1}
					value={draft}
					onChange={(event) => {
						setDraft(event.target.value);
						setSavedPercent(null);
						setError(null);
					}}
					className="w-20 px-2 py-1.5 rounded-lg text-sm border border-border bg-transparent text-foreground"
					data-testid="dispute-recovery-percent-input"
				/>
				<span className="text-sm text-muted-foreground">%</span>
				<button
					type="button"
					onClick={handleSave}
					disabled={isSaving}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-(--bg-hover) border border-border disabled:opacity-50"
					data-testid="dispute-recovery-save"
				>
					{isSaving ? (
						<>
							<Loader2 size={12} className="animate-spin" />
							{t(DisputesKeys.ADMIN_SAVING)}
						</>
					) : (
						t(DisputesKeys.ADMIN_SAVE)
					)}
				</button>
			</div>

			<p className="text-xs text-faint-foreground">
				{/* Zero is a choice, not an empty field — say which one is in force. */}
				{parsed === 0
					? t(DisputesKeys.ADMIN_DISABLED_HINT)
					: t(DisputesKeys.ADMIN_HINT, { percent: parsed })}
			</p>

			{savedPercent !== null && (
				<p className="text-xs text-success" data-testid="dispute-recovery-saved">
					{t(DisputesKeys.ADMIN_SAVED, { percent: savedPercent })}
				</p>
			)}
			{error && <InlineError message={error} />}
		</Surface>
	);
}
