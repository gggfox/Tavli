import {
	SettingsRow,
	settingsInputClass,
} from "@/features/restaurants/components/settings/SettingsRow";
import { SettingsSection } from "@/features/restaurants/components/settings/SettingsSection";
import { SettingsSectionFooter } from "@/features/restaurants/components/settings/SettingsSectionFooter";
import type { RestaurantSettingsSectionProps } from "@/features/restaurants/components/settings/types";
import { RestaurantsKeys } from "@/global/i18n";
import { useForm } from "@tanstack/react-form";
import { sanitizeSlugInput, SLUG_ERROR } from "convex/slugHelpers";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Name, public address and description. Active/inactive moved to the settings
 * header and currency left the UI (every restaurant is MXN; the stored field
 * stays) — see the settings grilling.
 */
export function GeneralSection({
	restaurant,
	onSave,
	isSaving,
	isSaved,
	error,
	errorCode,
	onDismissError,
}: Readonly<RestaurantSettingsSectionProps>) {
	const { t } = useTranslation();

	const form = useForm({
		defaultValues: {
			name: restaurant.name,
			slug: restaurant.slug,
			description: restaurant.description ?? "",
		},
		onSubmit: async ({ value }) => {
			const saved = await onSave({
				name: value.name,
				slug: value.slug,
				description: value.description,
			});
			if (saved) form.reset(value);
		},
	});

	/**
	 * The canvas renders during SSR, where there is no `location`. Same guard the
	 * storage helpers use; an empty origin just renders the path-only preview.
	 */
	const publicOrigin = globalThis.window === undefined ? "" : globalThis.location.origin;
	/**
	 * A rejected slug belongs on the slug input. Without this the only feedback
	 * was the footer's generic "Failed to update restaurant", four fields away
	 * from the one that caused it.
	 */
	const slugError =
		errorCode === SLUG_ERROR.TAKEN || errorCode === SLUG_ERROR.INVALID ? error : null;

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				e.stopPropagation();
				form.handleSubmit();
			}}
		>
			<SettingsSection
				testId="settings-section-general"
				title={t(RestaurantsKeys.SETTINGS_GENERAL_TITLE)}
				hint={t(RestaurantsKeys.SETTINGS_GENERAL_HINT)}
				footer={
					<form.Subscribe
						selector={(state) => state.isDefaultValue}
						children={(isDefaultValue) => (
							<SettingsSectionFooter
								testId="settings-save-general"
								canSave={!isDefaultValue}
								isSaving={isSaving}
								isSaved={isSaved}
								// A slug failure is shown on the field instead — repeating it
								// here would say the same thing twice.
								error={slugError ? null : error}
								onDismissError={onDismissError}
							/>
						)}
					/>
				}
			>
				<form.Field
					name="name"
					children={(field) => (
						<SettingsRow label={t(RestaurantsKeys.FORM_NAME_LABEL)} htmlFor="restaurant-name">
							<input
								id="restaurant-name"
								type="text"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								required
								className={settingsInputClass("w-full max-w-md")}
							/>
						</SettingsRow>
					)}
				/>

				<form.Field
					name="slug"
					children={(field) => {
						// Everything below reads the LIVE field value, not
						// `form.state.values` — the section body does not re-render on a
						// keystroke, so a preview built up there would lag one edit behind.
						const slugValue = field.state.value;
						const slugPreview = slugValue || t(RestaurantsKeys.FORM_SLUG_PLACEHOLDER);
						const testUrl = `/r/${slugPreview}/en/menu`;
						/** Editing a live slug retires every link and QR code pointing at it. */
						const slugChanged = slugValue !== restaurant.slug;
						return (
							<SettingsRow label={t(RestaurantsKeys.FORM_SLUG_LABEL)} htmlFor="restaurant-slug">
								<input
									id="restaurant-slug"
									type="text"
									value={field.state.value}
									onChange={(e) => field.handleChange(sanitizeSlugInput(e.target.value))}
									onBlur={field.handleBlur}
									required
									aria-invalid={slugError ? true : undefined}
									aria-describedby="restaurant-slug-url"
									className={settingsInputClass("w-full max-w-md", Boolean(slugError))}
								/>
								{/* The public address, with the editable part called out — the
							    rest of the URL is fixed and must not read as editable. */}
								<div className="flex flex-wrap items-center gap-2 mt-1">
									<p id="restaurant-slug-url" className="text-xs text-faint-foreground">
										{t(RestaurantsKeys.FORM_SLUG_HINT)}{" "}
										<span data-testid="settings-slug-url">
											<span>{publicOrigin}/r/</span>
											<span
												data-testid="settings-slug-url-slug"
												className="font-semibold text-foreground bg-accent/10 rounded px-1 py-0.5"
											>
												{slugPreview}
											</span>
											<span>/en/menu</span>
										</span>
									</p>
									{slugValue ? (
										<a
											href={testUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded hover:bg-hover text-accent"
										>
											<ExternalLink size={12} />
											{t(RestaurantsKeys.FORM_OPEN_TEST_LINK)}
										</a>
									) : null}
								</div>
								{slugError ? (
									<p
										data-testid="settings-slug-error"
										role="alert"
										className="mt-1 text-xs text-destructive"
									>
										{slugError}
									</p>
								) : null}
								{slugChanged ? (
									<p
										data-testid="settings-slug-change-warning"
										className="mt-1 flex items-start gap-1 text-xs text-warning"
									>
										<AlertTriangle size={12} className="mt-0.5 shrink-0" />
										{t(RestaurantsKeys.FORM_SLUG_CHANGE_WARNING, { slug: restaurant.slug })}
									</p>
								) : null}
							</SettingsRow>
						);
					}}
				/>

				<form.Field
					name="description"
					children={(field) => (
						<SettingsRow
							label={t(RestaurantsKeys.FORM_DESCRIPTION_LABEL)}
							htmlFor="restaurant-desc"
						>
							<textarea
								id="restaurant-desc"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								rows={3}
								className={settingsInputClass("w-full")}
							/>
						</SettingsRow>
					)}
				/>
			</SettingsSection>
		</form>
	);
}
