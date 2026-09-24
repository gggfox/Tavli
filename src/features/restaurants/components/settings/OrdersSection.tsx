import { SettingsRow } from "@/features/restaurants/components/settings/SettingsRow";
import { SettingsSection } from "@/features/restaurants/components/settings/SettingsSection";
import { SettingsSectionFooter } from "@/features/restaurants/components/settings/SettingsSectionFooter";
import type { RestaurantSettingsSectionProps } from "@/features/restaurants/components/settings/types";
import { RestaurantsKeys } from "@/global/i18n";
import { useForm } from "@tanstack/react-form";
import { useTranslation } from "react-i18next";

/**
 * How a committed round reaches the kitchen — its own section rather than a
 * field in "Hours & time zone", which is about the service day (rollover,
 * reports, shifts). This is a service policy: who waits on whom, and who
 * carries the walkout risk.
 *
 * One setting today (`releaseCashOrdersImmediately`, TAVLI-81). Manager or
 * above, like the rest of this canvas — a restaurant deciding whether it
 * trusts its own tables is exactly the call the people running the floor
 * should be able to make.
 */
export function OrdersSection({
	restaurant,
	onSave,
	isSaving,
	isSaved,
	error,
	onDismissError,
}: Readonly<RestaurantSettingsSectionProps>) {
	const { t } = useTranslation();

	const form = useForm({
		defaultValues: {
			// Missing is off — the ADR 008 default every pre-toggle restaurant has.
			releaseCashOrdersImmediately: restaurant.releaseCashOrdersImmediately ?? false,
		},
		onSubmit: async ({ value }) => {
			const saved = await onSave({
				releaseCashOrdersImmediately: value.releaseCashOrdersImmediately,
			});
			if (saved) form.reset(value);
		},
	});

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				e.stopPropagation();
				form.handleSubmit();
			}}
		>
			<SettingsSection
				testId="settings-section-orders"
				title={t(RestaurantsKeys.SETTINGS_ORDERS_TITLE)}
				hint={t(RestaurantsKeys.SETTINGS_ORDERS_HINT)}
				footer={
					<form.Subscribe
						selector={(state) => state.isDefaultValue}
						children={(isDefaultValue) => (
							<SettingsSectionFooter
								testId="settings-save-orders"
								canSave={!isDefaultValue}
								isSaving={isSaving}
								isSaved={isSaved}
								error={error}
								onDismissError={onDismissError}
							/>
						)}
					/>
				}
			>
				<form.Field
					name="releaseCashOrdersImmediately"
					children={(field) => (
						<SettingsRow
							label={t(RestaurantsKeys.SETTINGS_ORDERS_RELEASE_CASH_LABEL)}
							htmlFor="restaurant-release-cash"
						>
							{/* The hint spells out both states and who carries the walkout
							    risk — too long for the one-line row hint, so it sits beside
							    the checkbox it describes. */}
							<div className="flex items-start gap-3">
								<input
									id="restaurant-release-cash"
									type="checkbox"
									checked={field.state.value}
									onChange={(e) => field.handleChange(e.target.checked)}
									onBlur={field.handleBlur}
									aria-describedby="restaurant-release-cash-hint"
									className="mt-0.5 shrink-0 rounded border-border"
								/>
								<p id="restaurant-release-cash-hint" className="text-xs text-faint-foreground">
									{t(RestaurantsKeys.SETTINGS_ORDERS_RELEASE_CASH_HINT)}
								</p>
							</div>
						</SettingsRow>
					)}
				/>
			</SettingsSection>
		</form>
	);
}
