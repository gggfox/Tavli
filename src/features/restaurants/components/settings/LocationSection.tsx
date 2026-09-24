import { LocationPicker, LocationPreview } from "@/features/restaurants/components/LocationPicker";
import {
	SettingsRow,
	settingsInputClass,
} from "@/features/restaurants/components/settings/SettingsRow";
import { SettingsSection } from "@/features/restaurants/components/settings/SettingsSection";
import { SettingsSectionFooter } from "@/features/restaurants/components/settings/SettingsSectionFooter";
import type { RestaurantSettingsSectionProps } from "@/features/restaurants/components/settings/types";
import { DialogHeader, Drawer } from "@/global/components";
import { RestaurantsKeys } from "@/global/i18n";
import { useForm } from "@tanstack/react-form";
import { DEFAULT_GEOFENCE_RADIUS_METERS } from "convex/constants";
import { LocateFixed, MapPin } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/** "" → null (clear); otherwise a finite number or null when unparsable. */
export function parseCoordinate(s: string): number | null {
	const trimmed = s.trim();
	if (!trimmed) return null;
	const parsed = Number.parseFloat(trimmed);
	return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Pin, ordering radius and bypass code. The row shows a small read-only map;
 * moving the pin happens in a full-height picker overlay (full-screen on a
 * phone), because an inline interactive map inside a scrolling settings page
 * swallows the scroll gesture on touch screens.
 */
export function LocationSection({
	restaurant,
	onSave,
	isSaving,
	isSaved,
	error,
	onDismissError,
}: Readonly<RestaurantSettingsSectionProps>) {
	const { t } = useTranslation();
	const [locationRecenterKey, setLocationRecenterKey] = useState(0);
	const [isPickerOpen, setIsPickerOpen] = useState(false);

	const form = useForm({
		defaultValues: {
			latitude: restaurant.latitude != null ? String(restaurant.latitude) : "",
			longitude: restaurant.longitude != null ? String(restaurant.longitude) : "",
			geofenceRadiusMeters:
				restaurant.geofenceRadiusMeters != null ? String(restaurant.geofenceRadiusMeters) : "",
			geofenceBypassCode: restaurant.geofenceBypassCode ?? "",
		},
		onSubmit: async ({ value }) => {
			const saved = await onSave({
				latitude: parseCoordinate(value.latitude),
				longitude: parseCoordinate(value.longitude),
				geofenceRadiusMeters: parseCoordinate(value.geofenceRadiusMeters),
				geofenceBypassCode: value.geofenceBypassCode.trim() || null,
			});
			if (saved) form.reset(value);
		},
	});

	const centreOnMyLocation = () => {
		if (typeof navigator === "undefined" || !navigator.geolocation) return;
		navigator.geolocation.getCurrentPosition((position) => {
			form.setFieldValue("latitude", String(position.coords.latitude));
			form.setFieldValue("longitude", String(position.coords.longitude));
			setLocationRecenterKey((key) => key + 1);
		});
	};

	const myLocationButton = (
		<button
			type="button"
			onClick={centreOnMyLocation}
			className="inline-flex items-center gap-1 text-xs font-medium underline text-muted-foreground"
		>
			<LocateFixed size={12} aria-hidden />
			{t(RestaurantsKeys.FORM_GEOFENCE_USE_MY_LOCATION)}
		</button>
	);

	const closePicker = () => setIsPickerOpen(false);

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				e.stopPropagation();
				form.handleSubmit();
			}}
		>
			<SettingsSection
				testId="settings-section-location"
				title={t(RestaurantsKeys.FORM_GEOFENCE_SECTION_TITLE)}
				hint={t(RestaurantsKeys.FORM_GEOFENCE_SECTION_HINT)}
				footer={
					<form.Subscribe
						selector={(state) => state.isDefaultValue}
						children={(isDefaultValue) => (
							<SettingsSectionFooter
								testId="settings-save-location"
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
				<form.Subscribe
					selector={(state) => ({
						latitude: state.values.latitude,
						longitude: state.values.longitude,
						radius: state.values.geofenceRadiusMeters,
					})}
					children={({ latitude, longitude, radius }) => {
						const lat = parseCoordinate(latitude);
						const lng = parseCoordinate(longitude);
						const radiusMeters = parseCoordinate(radius) ?? DEFAULT_GEOFENCE_RADIUS_METERS;
						const hasPin = lat != null && lng != null;
						return (
							<SettingsRow
								label={t(RestaurantsKeys.SETTINGS_NAV_LOCATION)}
								hint={
									hasPin
										? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
										: t(RestaurantsKeys.SETTINGS_NAV_NOT_SET)
								}
								testId="settings-location-pin"
							>
								{/* A picture of the pin, not a control: the map ignores the
								    pointer and the button below is the way in. */}
								<div
									className="relative h-40 w-full max-w-md overflow-hidden rounded-lg border border-border bg-muted z-0"
									aria-hidden
								>
									<LocationPreview latitude={lat} longitude={lng} radiusMeters={radiusMeters} />
									{hasPin ? null : (
										<div className="absolute inset-0 z-[500] flex items-center justify-center bg-background/60">
											<MapPin size={20} className="text-faint-foreground" />
										</div>
									)}
								</div>
								<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
									<button
										type="button"
										onClick={() => setIsPickerOpen(true)}
										data-testid="settings-location-adjust-pin"
										className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-hover"
									>
										<MapPin size={14} aria-hidden />
										{t(RestaurantsKeys.FORM_GEOFENCE_ADJUST_PIN)}
									</button>
									{myLocationButton}
								</div>

								<details className="group mt-3">
									<summary className="cursor-pointer text-xs font-medium text-muted-foreground">
										{t(RestaurantsKeys.FORM_GEOFENCE_COORDINATES_ADVANCED)}
									</summary>
									<div className="mt-3 grid max-w-md grid-cols-2 gap-3">
										<form.Field
											name="latitude"
											children={(field) => (
												<div>
													<label
														htmlFor="restaurant-latitude"
														className="block text-xs font-medium mb-1 text-foreground"
													>
														{t(RestaurantsKeys.FORM_GEOFENCE_LATITUDE_LABEL)}
													</label>
													<input
														id="restaurant-latitude"
														type="number"
														step="any"
														min="-90"
														max="90"
														value={field.state.value}
														onChange={(e) => field.handleChange(e.target.value)}
														onBlur={field.handleBlur}
														className={settingsInputClass("w-full")}
													/>
												</div>
											)}
										/>
										<form.Field
											name="longitude"
											children={(field) => (
												<div>
													<label
														htmlFor="restaurant-longitude"
														className="block text-xs font-medium mb-1 text-foreground"
													>
														{t(RestaurantsKeys.FORM_GEOFENCE_LONGITUDE_LABEL)}
													</label>
													<input
														id="restaurant-longitude"
														type="number"
														step="any"
														min="-180"
														max="180"
														value={field.state.value}
														onChange={(e) => field.handleChange(e.target.value)}
														onBlur={field.handleBlur}
														className={settingsInputClass("w-full")}
													/>
												</div>
											)}
										/>
									</div>
								</details>

								{/* The overlay edits the same form fields live, so closing it is
								    "done" — the section's own Save still commits. */}
								<Drawer
									isOpen={isPickerOpen}
									onClose={closePicker}
									ariaLabel={t(RestaurantsKeys.FORM_GEOFENCE_SECTION_TITLE)}
									side="right"
									size="min(720px, 100vw)"
									panelClassName="bg-background border-l border-border"
								>
									<DialogHeader
										title={t(RestaurantsKeys.FORM_GEOFENCE_SECTION_TITLE)}
										subtitle={t(RestaurantsKeys.FORM_GEOFENCE_MAP_HINT)}
										onClose={closePicker}
										closeAriaLabel={t(RestaurantsKeys.FORM_GEOFENCE_PICKER_CLOSE)}
									/>
									<div className="flex min-h-0 flex-1 flex-col gap-3 p-4 sm:p-6">
										<div className="min-h-0 flex-1">
											<LocationPicker
												latitude={lat}
												longitude={lng}
												radiusMeters={radiusMeters}
												recenterKey={locationRecenterKey}
												fill
												onChange={({ latitude: nextLat, longitude: nextLng }) => {
													form.setFieldValue("latitude", String(nextLat));
													form.setFieldValue("longitude", String(nextLng));
												}}
											/>
										</div>
										<div>{myLocationButton}</div>
									</div>
								</Drawer>
							</SettingsRow>
						);
					}}
				/>

				<form.Field
					name="geofenceRadiusMeters"
					children={(field) => (
						<SettingsRow
							label={t(RestaurantsKeys.FORM_GEOFENCE_RADIUS_LABEL)}
							htmlFor="restaurant-geofence-radius"
						>
							<input
								id="restaurant-geofence-radius"
								type="number"
								min="1"
								step="1"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								placeholder="150"
								className={settingsInputClass("w-32")}
							/>
						</SettingsRow>
					)}
				/>

				<form.Field
					name="geofenceBypassCode"
					children={(field) => (
						<SettingsRow
							label={t(RestaurantsKeys.FORM_GEOFENCE_BYPASS_LABEL)}
							htmlFor="restaurant-geofence-bypass"
						>
							<input
								id="restaurant-geofence-bypass"
								type="text"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value.toUpperCase())}
								onBlur={field.handleBlur}
								aria-describedby="restaurant-geofence-bypass-hint"
								className={`${settingsInputClass("w-full max-w-xs")} uppercase`}
							/>
							{/* Several sentences — too long for the one-line row hint. */}
							<p
								id="restaurant-geofence-bypass-hint"
								className="mt-1 max-w-md text-xs text-faint-foreground"
							>
								{t(RestaurantsKeys.FORM_GEOFENCE_BYPASS_HINT)}
							</p>
						</SettingsRow>
					)}
				/>
			</SettingsSection>
		</form>
	);
}
