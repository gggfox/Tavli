import { SettingsSection } from "@/features/restaurants/components/settings/SettingsSection";
import { SettingsSectionFooter } from "@/features/restaurants/components/settings/SettingsSectionFooter";
import type { RestaurantSettingsSectionProps } from "@/features/restaurants/components/settings/types";
import { StatusBadge } from "@/global/components";
import { RestaurantsKeys } from "@/global/i18n";
import { useForm } from "@tanstack/react-form";
import type { Id } from "convex/_generated/dataModel";
import { sanitizeSlugInput, SLUG_ERROR } from "convex/slugHelpers";
import { AlertTriangle, ExternalLink, ToggleLeft, ToggleRight } from "lucide-react";
import { useTranslation } from "react-i18next";

interface GeneralSectionProps extends RestaurantSettingsSectionProps {
	/** Omitted for managers -- activation stays an admin/owner action. */
	readonly onToggleActive?: (restaurantId: Id<"restaurants">) => void;
}

export function GeneralSection({
	restaurant,
	onSave,
	isSaving,
	isSaved,
	error,
	errorCode,
	onDismissError,
	onToggleActive,
}: Readonly<GeneralSectionProps>) {
	const { t } = useTranslation();

	const form = useForm({
		defaultValues: {
			name: restaurant.name,
			slug: restaurant.slug,
			description: restaurant.description ?? "",
			supportEmail: restaurant.supportEmail ?? "",
			currency: restaurant.currency,
		},
		onSubmit: async ({ value }) => {
			const saved = await onSave({
				name: value.name,
				slug: value.slug,
				description: value.description,
				supportEmail: value.supportEmail,
				currency: value.currency,
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
				{onToggleActive ? (
					<div className="flex items-center justify-between px-4 py-3 rounded-lg bg-background border border-border">
						<div className="flex items-center gap-3">
							<span className="text-sm font-medium text-foreground">
								{t(RestaurantsKeys.FORM_STATUS_LABEL)}
							</span>
							<StatusBadge
								bgColor={restaurant.isActive ? "var(--accent-success)" : "var(--bg-tertiary)"}
								textColor={restaurant.isActive ? "white" : "var(--text-muted)"}
								label={
									restaurant.isActive
										? t(RestaurantsKeys.LIST_STATUS_ACTIVE)
										: t(RestaurantsKeys.LIST_STATUS_INACTIVE)
								}
							/>
						</div>
						<button
							type="button"
							onClick={() => onToggleActive(restaurant._id)}
							className="p-1.5 rounded-md hover:bg-hover text-success"
							title={
								restaurant.isActive
									? t(RestaurantsKeys.FORM_TOGGLE_DEACTIVATE_TITLE)
									: t(RestaurantsKeys.FORM_TOGGLE_ACTIVATE_TITLE)
							}
						>
							{restaurant.isActive ? (
								<ToggleRight size={24} />
							) : (
								<ToggleLeft size={24} className="text-faint-foreground" />
							)}
						</button>
					</div>
				) : null}

				<form.Field
					name="name"
					children={(field) => (
						<div>
							<label
								htmlFor="restaurant-name"
								className="block text-sm font-medium mb-1 text-foreground"
							>
								{t(RestaurantsKeys.FORM_NAME_LABEL)}
							</label>
							<input
								id="restaurant-name"
								type="text"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								required
								className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
							/>
						</div>
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
							<div>
								<label
									htmlFor="restaurant-slug"
									className="block text-sm font-medium mb-1 text-foreground"
								>
									{t(RestaurantsKeys.FORM_SLUG_LABEL)}
								</label>
								<input
									id="restaurant-slug"
									type="text"
									value={field.state.value}
									onChange={(e) => field.handleChange(sanitizeSlugInput(e.target.value))}
									onBlur={field.handleBlur}
									required
									aria-invalid={slugError ? true : undefined}
									aria-describedby="restaurant-slug-url"
									className={`w-full px-3 py-2 rounded-lg text-sm bg-muted border text-foreground ${
										slugError ? "border-destructive" : "border-border"
									}`}
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
							</div>
						);
					}}
				/>

				<form.Field
					name="description"
					children={(field) => (
						<div>
							<label
								htmlFor="restaurant-desc"
								className="block text-sm font-medium mb-1 text-foreground"
							>
								{t(RestaurantsKeys.FORM_DESCRIPTION_LABEL)}
							</label>
							<textarea
								id="restaurant-desc"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								rows={3}
								className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
							/>
						</div>
					)}
				/>

				<form.Field
					name="supportEmail"
					children={(field) => (
						<div>
							<label
								htmlFor="restaurant-support-email"
								className="block text-sm font-medium mb-1 text-foreground"
							>
								{t(RestaurantsKeys.FORM_SUPPORT_EMAIL_LABEL)}
							</label>
							<input
								id="restaurant-support-email"
								type="email"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
							/>
							<p className="mt-1 text-xs text-faint-foreground">
								{t(RestaurantsKeys.FORM_SUPPORT_EMAIL_HINT)}
							</p>
						</div>
					)}
				/>

				<form.Field
					name="currency"
					children={(field) => (
						<div className="max-w-xs">
							<label
								htmlFor="restaurant-currency"
								className="block text-sm font-medium mb-1 text-foreground"
							>
								{t(RestaurantsKeys.FORM_CURRENCY_LABEL)}
							</label>
							<select
								id="restaurant-currency"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
							>
								<option value="USD">USD ($)</option>
								<option value="EUR">EUR (&euro;)</option>
								<option value="GBP">GBP (&pound;)</option>
								<option value="MXN">MXN ($)</option>
							</select>
						</div>
					)}
				/>
			</SettingsSection>
		</form>
	);
}
