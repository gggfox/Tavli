import { LocationPicker } from "@/features/restaurants/components/LocationPicker";
import { SettingsSection } from "@/features/restaurants/components/settings/SettingsSection";
import { SettingsSectionFooter } from "@/features/restaurants/components/settings/SettingsSectionFooter";
import type { RestaurantSettingsSectionProps } from "@/features/restaurants/components/settings/types";
import { RestaurantsKeys } from "@/global/i18n";
import { useForm } from "@tanstack/react-form";
import { DEFAULT_GEOFENCE_RADIUS_METERS } from "convex/constants";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/** "" → null (clear); otherwise a finite number or null when unparsable. */
export function parseCoordinate(s: string): number | null {
	const trimmed = s.trim();
	if (!trimmed) return null;
	const parsed = Number.parseFloat(trimmed);
	return Number.isFinite(parsed) ? parsed : null;
}

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
				<p className="text-xs text-faint-foreground">{t(RestaurantsKeys.FORM_GEOFENCE_MAP_HINT)}</p>

				<form.Subscribe
					selector={(state) => ({
						latitude: state.values.latitude,
						longitude: state.values.longitude,
						radius: state.values.geofenceRadiusMeters,
					})}
					children={({ latitude, longitude, radius }) => (
						<LocationPicker
							latitude={parseCoordinate(latitude)}
							longitude={parseCoordinate(longitude)}
							radiusMeters={parseCoordinate(radius) ?? DEFAULT_GEOFENCE_RADIUS_METERS}
							recenterKey={locationRecenterKey}
							onChange={({ latitude: lat, longitude: lng }) => {
								form.setFieldValue("latitude", String(lat));
								form.setFieldValue("longitude", String(lng));
							}}
						/>
					)}
				/>

				<button
					type="button"
					onClick={() => {
						if (typeof navigator === "undefined" || !navigator.geolocation) return;
						navigator.geolocation.getCurrentPosition((position) => {
							form.setFieldValue("latitude", String(position.coords.latitude));
							form.setFieldValue("longitude", String(position.coords.longitude));
							setLocationRecenterKey((key) => key + 1);
						});
					}}
					className="text-xs font-medium underline text-muted-foreground"
				>
					{t(RestaurantsKeys.FORM_GEOFENCE_USE_MY_LOCATION)}
				</button>

				<details className="group">
					<summary className="cursor-pointer text-xs font-medium text-muted-foreground">
						{t(RestaurantsKeys.FORM_GEOFENCE_COORDINATES_ADVANCED)}
					</summary>
					<div className="mt-3 grid grid-cols-2 gap-4">
						<form.Field
							name="latitude"
							children={(field) => (
								<div>
									<label
										htmlFor="restaurant-latitude"
										className="block text-sm font-medium mb-1 text-foreground"
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
										className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
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
										className="block text-sm font-medium mb-1 text-foreground"
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
										className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
									/>
								</div>
							)}
						/>
					</div>
				</details>

				<div>
					<div className="grid grid-cols-2 gap-4">
						<form.Field
							name="geofenceRadiusMeters"
							children={(field) => (
								<div>
									<label
										htmlFor="restaurant-geofence-radius"
										className="block text-sm font-medium mb-1 text-foreground"
									>
										{t(RestaurantsKeys.FORM_GEOFENCE_RADIUS_LABEL)}
									</label>
									<input
										id="restaurant-geofence-radius"
										type="number"
										min="1"
										step="1"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder="150"
										className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
									/>
								</div>
							)}
						/>
						<form.Field
							name="geofenceBypassCode"
							children={(field) => (
								<div>
									<label
										htmlFor="restaurant-geofence-bypass"
										className="block text-sm font-medium mb-1 text-foreground"
									>
										{t(RestaurantsKeys.FORM_GEOFENCE_BYPASS_LABEL)}
									</label>
									<input
										id="restaurant-geofence-bypass"
										type="text"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value.toUpperCase())}
										onBlur={field.handleBlur}
										className="w-full px-3 py-2 rounded-lg text-sm uppercase bg-muted border border-border text-foreground"
									/>
								</div>
							)}
						/>
					</div>
					<p className="mt-1 text-xs text-faint-foreground">
						{t(RestaurantsKeys.FORM_GEOFENCE_BYPASS_HINT)}
					</p>
				</div>
			</SettingsSection>
		</form>
	);
}
