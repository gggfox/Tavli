import { InlineError } from "@/global/components";
import { RestaurantsKeys } from "@/global/i18n";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";

interface SettingsSectionFooterProps {
	/** Section has unsaved edits -- gates the submit button. */
	readonly canSave: boolean;
	readonly isSaving: boolean;
	readonly isSaved: boolean;
	readonly error: string | null;
	readonly onDismissError: () => void;
	readonly testId?: string;
}

/**
 * Per-section save affordance: dirty-gated submit plus that section's own
 * error / saved feedback, so one failing section never blanks another.
 */
export function SettingsSectionFooter({
	canSave,
	isSaving,
	isSaved,
	error,
	onDismissError,
	testId,
}: Readonly<SettingsSectionFooterProps>) {
	const { t } = useTranslation();
	return (
		<div className="space-y-3">
			{error ? <InlineError message={error} onDismiss={onDismissError} /> : null}
			<div className="flex items-center gap-3">
				<button
					type="submit"
					data-testid={testId}
					disabled={!canSave || isSaving}
					className="px-5 py-2 rounded-lg text-sm font-medium hover-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
				>
					{isSaving ? t(RestaurantsKeys.SETTINGS_SAVING) : t(RestaurantsKeys.FORM_SAVE_CHANGES)}
				</button>
				{isSaved && !canSave && !isSaving ? (
					<span className="flex items-center gap-1 text-xs font-medium text-success">
						<Check size={14} />
						{t(RestaurantsKeys.SETTINGS_SAVED)}
					</span>
				) : null}
			</div>
		</div>
	);
}
