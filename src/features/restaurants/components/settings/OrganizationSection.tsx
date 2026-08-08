import { SettingsSection } from "@/features/restaurants/components/settings/SettingsSection";
import { SettingsSectionFooter } from "@/features/restaurants/components/settings/SettingsSectionFooter";
import type { RestaurantSettingsSectionProps } from "@/features/restaurants/components/settings/types";
import { useOrganizations } from "@/features/restaurants/hooks/useOrganizations";
import { RestaurantsKeys } from "@/global/i18n";
import { getErrorMessage } from "@/global/utils/errorMessages";
import { useForm } from "@tanstack/react-form";
import type { Id } from "convex/_generated/dataModel";
import { useTranslation } from "react-i18next";

/**
 * Which organization owns this restaurant. Admin-only.
 *
 * The old modal hid the field entirely when the organizations query returned
 * nothing, so a slow or failing query looked identical to "there is no such
 * setting". Here the section always renders and explains itself instead.
 */
export function OrganizationSection({
	restaurant,
	onSave,
	isSaving,
	isSaved,
	error,
	onDismissError,
}: Readonly<RestaurantSettingsSectionProps>) {
	const { t } = useTranslation();
	const { organizations, isLoading, error: loadError } = useOrganizations();

	const form = useForm({
		defaultValues: { organizationId: String(restaurant.organizationId) },
		onSubmit: async ({ value }) => {
			const saved = await onSave({
				organizationId: value.organizationId as Id<"organizations">,
			});
			if (saved) form.reset(value);
		},
	});

	const currentIsListed = organizations.some(
		(org) => String(org._id) === form.state.values.organizationId
	);
	const isSelectDisabled = isLoading || Boolean(loadError) || organizations.length === 0;

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				e.stopPropagation();
				form.handleSubmit();
			}}
		>
			<SettingsSection
				testId="settings-section-organization"
				title={t(RestaurantsKeys.SETTINGS_ORG_TITLE)}
				hint={t(RestaurantsKeys.SETTINGS_ORG_HINT)}
				footer={
					<form.Subscribe
						selector={(state) => state.isDefaultValue}
						children={(isDefaultValue) => (
							<SettingsSectionFooter
								testId="settings-save-organization"
								canSave={!isDefaultValue && !isSelectDisabled}
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
					name="organizationId"
					children={(field) => (
						<div>
							<label
								htmlFor="restaurant-org"
								className="block text-sm font-medium mb-1 text-foreground"
							>
								{t(RestaurantsKeys.FORM_ORG_LABEL)}
							</label>
							<select
								id="restaurant-org"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								disabled={isSelectDisabled}
								required
								className="w-full max-w-sm px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground disabled:opacity-60"
							>
								<option value="" disabled>
									{t(RestaurantsKeys.FORM_ORG_PLACEHOLDER)}
								</option>
								{/* Keep the current organization selectable even when the
								    directory has not loaded, so the control never shows a
								    blank or silently reassigns the restaurant. The id is the
								    option's VALUE only — its label is localized copy, because
								    a raw Convex document id means nothing to a human. */}
								{currentIsListed ? null : (
									<option value={String(restaurant.organizationId)}>
										{t(RestaurantsKeys.SETTINGS_ORG_CURRENT_UNRESOLVED)}
									</option>
								)}
								{organizations.map((org) => (
									<option key={org._id} value={org._id}>
										{org.name}
									</option>
								))}
							</select>
							{isLoading ? (
								<p className="mt-1 text-xs text-faint-foreground">
									{t(RestaurantsKeys.SETTINGS_ORG_LOADING)}
								</p>
							) : null}
							{/* Map the stable backend code (e.g. ERROR_OWNER_ROLE_REQUIRED)
							    when there is one, falling back to the generic copy. */}
							{!isLoading && loadError ? (
								<p className="mt-1 text-xs text-destructive">
									{getErrorMessage(loadError, t, RestaurantsKeys.SETTINGS_ORG_LOAD_FAILED)}
								</p>
							) : null}
							{!isLoading && !loadError && organizations.length === 0 ? (
								<p className="mt-1 text-xs text-faint-foreground">
									{t(RestaurantsKeys.SETTINGS_ORG_EMPTY)}
								</p>
							) : null}
						</div>
					)}
				/>
			</SettingsSection>
		</form>
	);
}
