import { SettingsSection } from "@/features/restaurants/components/settings/SettingsSection";
import { SettingsSectionFooter } from "@/features/restaurants/components/settings/SettingsSectionFooter";
import type { RestaurantSettingsSectionProps } from "@/features/restaurants/components/settings/types";
import { SOCIAL_ICON } from "@/global/components/icons/SocialIcons";
import { RestaurantsKeys } from "@/global/i18n";
import type { BackendErrorCode } from "@/global/i18n/keys/errors";
import {
	normalizeSocialInput,
	SOCIAL_FIELD,
	SOCIAL_PLATFORM,
	SOCIAL_PLATFORMS,
	type SocialPlatform,
} from "convex/publicProfileHelpers";
import { useForm } from "@tanstack/react-form";
import { useTranslation } from "react-i18next";

/**
 * The Restaurant's **Public profile** — the contact details diners see on the
 * menu page and on emailed receipts.
 *
 * `supportEmail` lives here rather than in General because its meaning widened:
 * it used to be an ops-only routing address and is now the restaurant's public
 * contact email. Saving this section stamps `publicProfileReviewedAt`, which is
 * what lets the address reach diners — rows that predate this section had their
 * email entered under the old, narrower copy, so it stays private until a
 * manager has seen the new wording.
 */

const SOCIAL_LABEL_KEY: Record<SocialPlatform, string> = {
	[SOCIAL_PLATFORM.INSTAGRAM]: RestaurantsKeys.SETTINGS_PUBLIC_PROFILE_INSTAGRAM_LABEL,
	[SOCIAL_PLATFORM.FACEBOOK]: RestaurantsKeys.SETTINGS_PUBLIC_PROFILE_FACEBOOK_LABEL,
	[SOCIAL_PLATFORM.TIKTOK]: RestaurantsKeys.SETTINGS_PUBLIC_PROFILE_TIKTOK_LABEL,
	[SOCIAL_PLATFORM.X]: RestaurantsKeys.SETTINGS_PUBLIC_PROFILE_X_LABEL,
	[SOCIAL_PLATFORM.YOUTUBE]: RestaurantsKeys.SETTINGS_PUBLIC_PROFILE_YOUTUBE_LABEL,
};

const SOCIAL_ERROR_CODES: readonly BackendErrorCode[] = [
	"ERROR_SOCIAL_URL_INVALID",
	"ERROR_SOCIAL_URL_WRONG_PLATFORM",
	"ERROR_SOCIAL_URL_SHORTLINK",
	"ERROR_SOCIAL_URL_INSECURE",
];

const PHONE_ERROR_CODES: readonly BackendErrorCode[] = [
	"ERROR_INVALID_PHONE",
	"ERROR_PHONE_COUNTRY_CODE_REQUIRED",
];

export function PublicProfileSection({
	restaurant,
	onSave,
	isSaving,
	isSaved,
	error,
	errorCode,
	errorField,
	onDismissError,
}: Readonly<RestaurantSettingsSectionProps>) {
	const { t } = useTranslation();

	const form = useForm({
		defaultValues: {
			supportEmail: restaurant.supportEmail ?? "",
			address: restaurant.address ?? "",
			phone: restaurant.phone ?? "",
			phoneHasWhatsApp: restaurant.phoneHasWhatsApp ?? false,
			instagramUrl: restaurant.instagramUrl ?? "",
			facebookUrl: restaurant.facebookUrl ?? "",
			tiktokUrl: restaurant.tiktokUrl ?? "",
			xUrl: restaurant.xUrl ?? "",
			youtubeUrl: restaurant.youtubeUrl ?? "",
		},
		onSubmit: async ({ value }) => {
			const saved = await onSave({
				...value,
				// Belt to the server's braces: a flag with no number is a link to
				// nowhere, and the box stays visible while the phone is being edited.
				phoneHasWhatsApp: value.phone.trim() ? value.phoneHasWhatsApp : false,
				markPublicProfileReviewed: true,
			});
			if (saved) form.reset(value);
		},
	});

	/**
	 * A rejected value belongs on the input that caused it, not four fields away
	 * in the footer. Same idea as the slug pinning in `GeneralSection`.
	 */
	const emailError = errorCode === "ERROR_INVALID_SUPPORT_EMAIL" ? error : null;
	const addressError = errorCode === "ERROR_ADDRESS_TOO_LONG" ? error : null;
	const phoneError = errorCode && PHONE_ERROR_CODES.includes(errorCode) ? error : null;
	const whatsAppError = errorCode === "ERROR_WHATSAPP_WITHOUT_PHONE" ? error : null;
	// The five social inputs share their error codes, so the code alone cannot
	// say which one to underline — `errorField` names the guilty column.
	const socialError = errorCode && SOCIAL_ERROR_CODES.includes(errorCode) ? error : null;
	const socialErrorField = socialError ? errorField : null;
	const pinnedError = emailError ?? addressError ?? phoneError ?? whatsAppError ?? socialError;

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				e.stopPropagation();
				form.handleSubmit();
			}}
		>
			<SettingsSection
				testId="settings-section-public-profile"
				title={t(RestaurantsKeys.SETTINGS_PUBLIC_PROFILE_TITLE)}
				hint={t(RestaurantsKeys.SETTINGS_PUBLIC_PROFILE_HINT)}
				footer={
					<form.Subscribe
						selector={(state) => state.isDefaultValue}
						children={(isDefaultValue) => (
							<SettingsSectionFooter
								testId="settings-save-public-profile"
								canSave={!isDefaultValue}
								isSaving={isSaving}
								isSaved={isSaved}
								// A pinned failure is shown on its field instead — repeating it
								// here would say the same thing twice.
								error={pinnedError ? null : error}
								onDismissError={onDismissError}
							/>
						)}
					/>
				}
			>
				<form.Field
					name="supportEmail"
					children={(field) => (
						<div>
							<label
								htmlFor="restaurant-support-email"
								className="block text-sm font-medium mb-1 text-foreground"
							>
								{t(RestaurantsKeys.FORM_CONTACT_EMAIL_LABEL)}
							</label>
							<input
								id="restaurant-support-email"
								type="email"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								aria-invalid={emailError ? true : undefined}
								aria-describedby={
									emailError ? "restaurant-support-email-error" : "restaurant-support-email-hint"
								}
								className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
							/>
							{emailError ? (
								<p
									id="restaurant-support-email-error"
									role="alert"
									className="mt-1 text-xs text-destructive"
								>
									{emailError}
								</p>
							) : (
								<p
									id="restaurant-support-email-hint"
									className="mt-1 text-xs text-faint-foreground"
								>
									{t(RestaurantsKeys.FORM_CONTACT_EMAIL_HINT)}
								</p>
							)}
						</div>
					)}
				/>

				<form.Field
					name="address"
					children={(field) => (
						<div>
							<label
								htmlFor="restaurant-address"
								className="block text-sm font-medium mb-1 text-foreground"
							>
								{t(RestaurantsKeys.SETTINGS_PUBLIC_PROFILE_ADDRESS_LABEL)}
							</label>
							<textarea
								id="restaurant-address"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								rows={2}
								aria-invalid={addressError ? true : undefined}
								aria-describedby={
									addressError ? "restaurant-address-error" : "restaurant-address-hint"
								}
								className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
							/>
							{addressError ? (
								<p
									id="restaurant-address-error"
									role="alert"
									className="mt-1 text-xs text-destructive"
								>
									{addressError}
								</p>
							) : (
								<p id="restaurant-address-hint" className="mt-1 text-xs text-faint-foreground">
									{t(RestaurantsKeys.SETTINGS_PUBLIC_PROFILE_ADDRESS_HINT)}
								</p>
							)}
						</div>
					)}
				/>

				<form.Field
					name="phone"
					children={(field) => (
						<div className="max-w-xs">
							<label
								htmlFor="restaurant-phone"
								className="block text-sm font-medium mb-1 text-foreground"
							>
								{t(RestaurantsKeys.SETTINGS_PUBLIC_PROFILE_PHONE_LABEL)}
							</label>
							<input
								id="restaurant-phone"
								type="tel"
								inputMode="tel"
								autoComplete="tel"
								placeholder={t(RestaurantsKeys.SETTINGS_PUBLIC_PROFILE_PHONE_PLACEHOLDER)}
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								aria-invalid={phoneError ? true : undefined}
								aria-describedby={phoneError ? "restaurant-phone-error" : "restaurant-phone-hint"}
								className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
							/>
							{phoneError ? (
								<p
									id="restaurant-phone-error"
									role="alert"
									className="mt-1 text-xs text-destructive"
								>
									{phoneError}
								</p>
							) : (
								<p id="restaurant-phone-hint" className="mt-1 text-xs text-faint-foreground">
									{t(RestaurantsKeys.SETTINGS_PUBLIC_PROFILE_PHONE_HINT)}
								</p>
							)}
						</div>
					)}
				/>

				{/*
				 * Subscribed to `phone` rather than reading `form.state.values`: the
				 * section body does not re-render on a keystroke, so a direct read
				 * would lag one edit behind and hide the box after it mattered.
				 */}
				<form.Subscribe
					selector={(state) => state.values.phone.trim().length > 0}
					children={(hasPhone) =>
						hasPhone ? (
							<form.Field
								name="phoneHasWhatsApp"
								children={(field) => (
									<div>
										<label className="flex items-center gap-2 text-sm text-foreground">
											<input
												type="checkbox"
												checked={field.state.value}
												onChange={(e) => field.handleChange(e.target.checked)}
												onBlur={field.handleBlur}
												aria-describedby="restaurant-whatsapp-hint"
												className="rounded border-border"
											/>
											{t(RestaurantsKeys.SETTINGS_PUBLIC_PROFILE_WHATSAPP_LABEL)}
										</label>
										{whatsAppError ? (
											<p role="alert" className="mt-1 text-xs text-destructive">
												{whatsAppError}
											</p>
										) : (
											<p
												id="restaurant-whatsapp-hint"
												className="mt-1 text-xs text-faint-foreground"
											>
												{t(RestaurantsKeys.SETTINGS_PUBLIC_PROFILE_WHATSAPP_HINT)}
											</p>
										)}
									</div>
								)}
							/>
						) : null
					}
				/>

				<fieldset className="space-y-3 border-0 p-0 m-0">
					<legend className="text-sm font-medium text-foreground">
						{t(RestaurantsKeys.SETTINGS_PUBLIC_PROFILE_SOCIAL_HEADING)}
					</legend>
					<p className="text-xs text-faint-foreground">
						{t(RestaurantsKeys.SETTINGS_PUBLIC_PROFILE_SOCIAL_HINT)}
					</p>
					{SOCIAL_PLATFORMS.map((platform) => {
						const fieldName = SOCIAL_FIELD[platform];
						const Icon = SOCIAL_ICON[platform];
						const inputId = `restaurant-social-${platform}`;
						// Fall back to marking every social input when the backend named
						// no field: better to flag five than to swallow the message.
						const fieldError =
							socialError && (socialErrorField === fieldName || socialErrorField === null)
								? socialError
								: null;
						return (
							<form.Field
								key={platform}
								name={fieldName}
								children={(field) => (
									<div>
										<div className="flex items-center gap-2">
											<span
												className="text-faint-foreground shrink-0"
												title={t(SOCIAL_LABEL_KEY[platform])}
											>
												<Icon size={18} />
											</span>
											<label htmlFor={inputId} className="sr-only">
												{t(SOCIAL_LABEL_KEY[platform])}
											</label>
											<input
												id={inputId}
												type="text"
												inputMode="url"
												placeholder={t(SOCIAL_LABEL_KEY[platform])}
												value={field.state.value}
												// Store raw while typing — rewriting on every keystroke
												// jumps the caret. Normalize once the field is left.
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={() => {
													field.handleChange(normalizeSocialInput(platform, field.state.value));
													field.handleBlur();
												}}
												aria-invalid={fieldError ? true : undefined}
												aria-describedby={fieldError ? `${inputId}-error` : undefined}
												className={`w-full px-3 py-2 rounded-lg text-sm bg-muted text-foreground border ${
													fieldError ? "border-destructive" : "border-border"
												}`}
											/>
										</div>
										{fieldError ? (
											<p
												id={`${inputId}-error`}
												role="alert"
												className="mt-1 ml-7 text-xs text-destructive"
											>
												{fieldError}
											</p>
										) : null}
									</div>
								)}
							/>
						);
					})}
				</fieldset>
			</SettingsSection>
		</form>
	);
}
