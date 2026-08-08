import { SettingsSection } from "@/features/restaurants/components/settings/SettingsSection";
import { SettingsSectionFooter } from "@/features/restaurants/components/settings/SettingsSectionFooter";
import type { RestaurantSettingsSectionProps } from "@/features/restaurants/components/settings/types";
import { RestaurantsKeys } from "@/global/i18n";
import { useForm } from "@tanstack/react-form";
import { useTranslation } from "react-i18next";

/**
 * Informational tax block printed on diner receipt emails (ADR 008 /
 * TAVLI-71 Phase 3C). Display-only: Tavli does not issue CFDIs, so nothing
 * typed here is filed anywhere. Same access tier as `supportEmail`, i.e.
 * restaurant manager or above -- no extra gating in this component.
 */
export function TaxInfoSection({
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
			rfc: restaurant.rfc ?? "",
			razonSocial: restaurant.razonSocial ?? "",
			fiscalAddress: restaurant.fiscalAddress ?? "",
		},
		onSubmit: async ({ value }) => {
			// Empty strings are meaningful here -- the mutation trims them and
			// clears the stored field, which is how a restaurant removes its
			// tax block from receipts.
			const saved = await onSave({
				rfc: value.rfc,
				razonSocial: value.razonSocial,
				fiscalAddress: value.fiscalAddress,
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
				testId="settings-section-tax"
				title={t(RestaurantsKeys.SETTINGS_TAX_TITLE)}
				hint={t(RestaurantsKeys.SETTINGS_TAX_HINT)}
				footer={
					<form.Subscribe
						selector={(state) => state.isDefaultValue}
						children={(isDefaultValue) => (
							<SettingsSectionFooter
								testId="settings-save-tax"
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
					name="rfc"
					children={(field) => (
						<div className="max-w-xs">
							<label
								htmlFor="restaurant-rfc"
								className="block text-sm font-medium mb-1 text-foreground"
							>
								{t(RestaurantsKeys.SETTINGS_TAX_RFC_LABEL)}
							</label>
							<input
								id="restaurant-rfc"
								type="text"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value.toUpperCase())}
								onBlur={field.handleBlur}
								className="w-full px-3 py-2 rounded-lg text-sm uppercase bg-muted border border-border text-foreground"
							/>
						</div>
					)}
				/>

				<form.Field
					name="razonSocial"
					children={(field) => (
						<div>
							<label
								htmlFor="restaurant-razon-social"
								className="block text-sm font-medium mb-1 text-foreground"
							>
								{t(RestaurantsKeys.SETTINGS_TAX_RAZON_SOCIAL_LABEL)}
							</label>
							<input
								id="restaurant-razon-social"
								type="text"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
							/>
						</div>
					)}
				/>

				<form.Field
					name="fiscalAddress"
					children={(field) => (
						<div>
							<label
								htmlFor="restaurant-fiscal-address"
								className="block text-sm font-medium mb-1 text-foreground"
							>
								{t(RestaurantsKeys.SETTINGS_TAX_FISCAL_ADDRESS_LABEL)}
							</label>
							<textarea
								id="restaurant-fiscal-address"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								rows={2}
								className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
							/>
						</div>
					)}
				/>
			</SettingsSection>
		</form>
	);
}
