import { useCurrentUserRoles } from "@/features/users/hooks";
import { RestaurantsKeys } from "@/global/i18n";
import { isValidIanaTimezone } from "@/global/utils/timezone";
import { sanitizeSlug } from "@/global/utils/slug";
import { useForm } from "@tanstack/react-form";
import { DEFAULT_RESTAURANT_TIMEZONE, USER_ROLES } from "convex/constants";
import type { Doc, Id } from "convex/_generated/dataModel";
import { ExternalLink, ToggleLeft, ToggleRight } from "lucide-react";
import { useTranslation } from "react-i18next";

const DEFAULT_ORDER_DAY_START_MINUTES = 240;
const DEFAULT_ORDER_NUMBER_RESET_FREQUENCY: OrderNumberResetFrequency = "monthly";

const PRESET_TIMEZONES = [
	{
		id: "mexico_city",
		value: "America/Mexico_City",
		labelKey: RestaurantsKeys.FORM_TIMEZONE_OPTION_MEXICO_CITY,
	},
	{ id: "cancun", value: "America/Cancun", labelKey: RestaurantsKeys.FORM_TIMEZONE_OPTION_CANCUN },
	{
		id: "tijuana",
		value: "America/Tijuana",
		labelKey: RestaurantsKeys.FORM_TIMEZONE_OPTION_TIJUANA,
	},
	{
		id: "new_york",
		value: "America/New_York",
		labelKey: RestaurantsKeys.FORM_TIMEZONE_OPTION_NEW_YORK,
	},
	{ id: "utc", value: "UTC", labelKey: RestaurantsKeys.FORM_TIMEZONE_OPTION_UTC },
] as const;

const TIMEZONE_OTHER = "__other__";

function timezoneSelectValue(tz: string): string {
	const preset = PRESET_TIMEZONES.find((p) => p.value === tz);
	return preset?.value ?? TIMEZONE_OTHER;
}

type OrderNumberResetFrequency = "daily" | "weekly" | "biweekly" | "monthly";

function minutesToTimeInput(totalMinutes: number): string {
	const m = Math.min(1439, Math.max(0, totalMinutes));
	const h = Math.floor(m / 60);
	const min = m % 60;
	return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** "" → null (clear); otherwise a finite number or null when unparsable. */
function parseCoordinate(s: string): number | null {
	const trimmed = s.trim();
	if (!trimmed) return null;
	const parsed = Number.parseFloat(trimmed);
	return Number.isFinite(parsed) ? parsed : null;
}

function timeInputToMinutes(s: string): number {
	const parts = s.split(":");
	const h = Number.parseInt(parts[0] ?? "0", 10);
	const min = Number.parseInt(parts[1] ?? "0", 10);
	if (Number.isNaN(h) || Number.isNaN(min)) return DEFAULT_ORDER_DAY_START_MINUTES;
	return Math.min(1439, Math.max(0, h * 60 + min));
}

interface RestaurantSettingsFormProps {
	restaurant: Doc<"restaurants"> | null;
	organizations?: Doc<"organizations">[];
	onSave: (data: {
		name: string;
		slug: string;
		description?: string;
		currency: string;
		supportEmail?: string;
		timezone?: string;
		openTime?: string;
		closeTime?: string;
		orderDayStartMinutesFromMidnight: number;
		orderNumberResetFrequency?: OrderNumberResetFrequency;
		// Ordering geofence (TAVLI-6); null clears the value.
		latitude: number | null;
		longitude: number | null;
		geofenceRadiusMeters: number | null;
		geofenceBypassCode: string | null;
		organizationId: Id<"organizations">;
	}) => Promise<unknown>;
	onToggleActive?: (restaurantId: Id<"restaurants">) => Promise<unknown>;
	isSaving?: boolean;
	/** Org admins see all fields; managers edit operational settings only. */
	settingsAccess?: "full" | "manager";
}

export function RestaurantSettingsForm({
	restaurant,
	organizations,
	onSave,
	onToggleActive,
	isSaving,
	settingsAccess = "full",
}: Readonly<RestaurantSettingsFormProps>) {
	const { t } = useTranslation();
	const { roles } = useCurrentUserRoles();
	const isAdmin = roles.includes(USER_ROLES.ADMIN);
	const isManagerSettings = settingsAccess === "manager";
	const initialResetFrequency: OrderNumberResetFrequency =
		(restaurant?.orderNumberResetFrequency as OrderNumberResetFrequency | undefined) ??
		DEFAULT_ORDER_NUMBER_RESET_FREQUENCY;
	const form = useForm({
		defaultValues: {
			name: restaurant?.name ?? "",
			slug: restaurant?.slug ?? "",
			description: restaurant?.description ?? "",
			supportEmail: restaurant?.supportEmail ?? "",
			currency: restaurant?.currency ?? "MXN",
			timezone: restaurant?.timezone ?? DEFAULT_RESTAURANT_TIMEZONE,
			openTime: restaurant?.openTime ?? "10:00",
			closeTime: restaurant?.closeTime ?? "23:00",
			orderDayStartTime: minutesToTimeInput(
				restaurant?.orderDayStartMinutesFromMidnight ?? DEFAULT_ORDER_DAY_START_MINUTES
			),
			orderNumberResetFrequency: initialResetFrequency,
			latitude: restaurant?.latitude != null ? String(restaurant.latitude) : "",
			longitude: restaurant?.longitude != null ? String(restaurant.longitude) : "",
			geofenceRadiusMeters:
				restaurant?.geofenceRadiusMeters != null ? String(restaurant.geofenceRadiusMeters) : "",
			geofenceBypassCode: restaurant?.geofenceBypassCode ?? "",
			organizationId: (restaurant?.organizationId as string) ?? "",
		},
		onSubmit: async ({ value }) => {
			await onSave({
				name: value.name,
				slug: value.slug,
				description: value.description || undefined,
				supportEmail: value.supportEmail || undefined,
				currency: value.currency,
				timezone: value.timezone || undefined,
				openTime: value.openTime || undefined,
				closeTime: value.closeTime || undefined,
				orderDayStartMinutesFromMidnight: timeInputToMinutes(value.orderDayStartTime),
				...(isAdmin && {
					orderNumberResetFrequency: value.orderNumberResetFrequency,
				}),
				latitude: parseCoordinate(value.latitude),
				longitude: parseCoordinate(value.longitude),
				geofenceRadiusMeters: parseCoordinate(value.geofenceRadiusMeters),
				geofenceBypassCode: value.geofenceBypassCode.trim() || null,
				organizationId: value.organizationId as Id<"organizations">,
			});
		},
	});

	const slugValue = form.state.values.slug;
	const testUrl = `/r/${slugValue || "your-slug"}/en/menu`;

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				e.stopPropagation();
				form.handleSubmit();
			}}
			className="space-y-6 max-w-lg"
		>
			{restaurant && !isManagerSettings && (
				<div className="flex items-center justify-between px-4 py-3 rounded-lg bg-muted border border-border">
					<div className="flex items-center gap-3">
						<span className="text-sm font-medium text-foreground">
							{t(RestaurantsKeys.FORM_STATUS_LABEL)}
						</span>
						<span
							className="text-xs px-2 py-0.5 rounded-full font-medium"
							style={{
								backgroundColor: restaurant.isActive
									? "var(--accent-success)"
									: "var(--bg-tertiary)",
								color: restaurant.isActive ? "white" : "var(--text-muted)",
							}}
						>
							{restaurant.isActive
								? t(RestaurantsKeys.LIST_STATUS_ACTIVE)
								: t(RestaurantsKeys.LIST_STATUS_INACTIVE)}
						</span>
					</div>
					<button
						type="button"
						onClick={() => onToggleActive?.(restaurant._id)}
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
			)}

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
				children={(field) => (
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
							onChange={(e) => field.handleChange(sanitizeSlug(e.target.value))}
							onBlur={field.handleBlur}
							required
							className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
						/>
						<div className="flex items-center gap-2 mt-1">
							<p className="text-xs text-faint-foreground">
								{t(RestaurantsKeys.FORM_SLUG_HINT, { slug: slugValue || "your-slug" })}
							</p>
							{restaurant && slugValue && (
								<a
									href={testUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded hover:bg-hover text-accent"
								>
									<ExternalLink size={12} />
									{t(RestaurantsKeys.FORM_OPEN_TEST_LINK)}
								</a>
							)}
						</div>
					</div>
				)}
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

			<div className="grid grid-cols-2 gap-4">
				<form.Field
					name="currency"
					children={(field) => (
						<div>
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
				<form.Field
					name="timezone"
					children={(field) => {
						const selectValue = timezoneSelectValue(field.state.value);
						const showCustom = selectValue === TIMEZONE_OTHER;
						return (
							<div>
								<label
									htmlFor="restaurant-tz"
									className="block text-sm font-medium mb-1 text-foreground"
								>
									{t(RestaurantsKeys.FORM_TIMEZONE_LABEL)}
								</label>
								<select
									id="restaurant-tz"
									value={selectValue}
									onChange={(e) => {
										const next = e.target.value;
										if (next === TIMEZONE_OTHER) {
											if (PRESET_TIMEZONES.some((p) => p.value === field.state.value)) {
												field.handleChange("");
											}
											return;
										}
										field.handleChange(next);
									}}
									className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
								>
									{PRESET_TIMEZONES.map((preset) => (
										<option key={preset.id} value={preset.value}>
											{t(preset.labelKey)}
										</option>
									))}
									<option value={TIMEZONE_OTHER}>
										{t(RestaurantsKeys.FORM_TIMEZONE_OPTION_OTHER)}
									</option>
								</select>
								{showCustom ? (
									<input
										type="text"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(RestaurantsKeys.FORM_TIMEZONE_OTHER_PLACEHOLDER)}
										className="mt-2 w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
									/>
								) : null}
								{field.state.value.trim() && !isValidIanaTimezone(field.state.value.trim()) ? (
									<p className="mt-1 text-xs text-destructive">
										{t(RestaurantsKeys.FORM_TIMEZONE_MISSING_HINT)}
									</p>
								) : null}
							</div>
						);
					}}
				/>
			</div>

			<div className="grid grid-cols-2 gap-4">
				<form.Field
					name="openTime"
					children={(field) => (
						<div>
							<label
								htmlFor="restaurant-open-time"
								className="block text-sm font-medium mb-1 text-foreground"
							>
								{t(RestaurantsKeys.FORM_OPEN_TIME_LABEL)}
							</label>
							<input
								id="restaurant-open-time"
								type="time"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
							/>
						</div>
					)}
				/>
				<form.Field
					name="closeTime"
					children={(field) => (
						<div>
							<label
								htmlFor="restaurant-close-time"
								className="block text-sm font-medium mb-1 text-foreground"
							>
								{t(RestaurantsKeys.FORM_CLOSE_TIME_LABEL)}
							</label>
							<input
								id="restaurant-close-time"
								type="time"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
							/>
						</div>
					)}
				/>
			</div>
			<p className="text-xs text-faint-foreground -mt-4">
				{t(RestaurantsKeys.FORM_OPERATING_HOURS_HINT)}
			</p>

			<form.Field
				name="orderDayStartTime"
				children={(field) => (
					<div>
						<label
							htmlFor="restaurant-order-day-start"
							className="block text-sm font-medium mb-1 text-foreground"
						>
							{t(RestaurantsKeys.FORM_ORDER_DAY_START_LABEL)}
						</label>
						<input
							id="restaurant-order-day-start"
							type="time"
							value={field.state.value}
							onChange={(e) => field.handleChange(e.target.value)}
							className="w-full max-w-48 px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
						/>
						<p className="mt-1 text-xs text-faint-foreground max-w-lg">
							{t(RestaurantsKeys.FORM_ORDER_DAY_START_HINT)}
						</p>
					</div>
				)}
			/>

			{/* Ordering geofence (TAVLI-6) */}
			<div className="space-y-3 border-t border-border pt-6">
				<div>
					<h3 className="text-sm font-semibold text-foreground">
						{t(RestaurantsKeys.FORM_GEOFENCE_SECTION_TITLE)}
					</h3>
					<p className="mt-1 text-xs text-faint-foreground">
						{t(RestaurantsKeys.FORM_GEOFENCE_SECTION_HINT)}
					</p>
				</div>
				<div className="grid grid-cols-2 gap-4">
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
				<button
					type="button"
					onClick={() => {
						if (typeof navigator === "undefined" || !navigator.geolocation) return;
						navigator.geolocation.getCurrentPosition((position) => {
							form.setFieldValue("latitude", String(position.coords.latitude));
							form.setFieldValue("longitude", String(position.coords.longitude));
						});
					}}
					className="text-xs font-medium underline text-muted-foreground"
				>
					{t(RestaurantsKeys.FORM_GEOFENCE_USE_MY_LOCATION)}
				</button>
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
				<p className="text-xs text-faint-foreground">
					{t(RestaurantsKeys.FORM_GEOFENCE_BYPASS_HINT)}
				</p>
			</div>

			{isAdmin && !isManagerSettings && (
				<form.Field
					name="orderNumberResetFrequency"
					children={(field) => (
						<div>
							<label
								htmlFor="restaurant-order-number-reset"
								className="block text-sm font-medium mb-1 text-foreground"
							>
								{t(RestaurantsKeys.FORM_ORDER_NUMBER_RESET_LABEL)}
							</label>
							<select
								id="restaurant-order-number-reset"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value as OrderNumberResetFrequency)}
								className="w-full max-w-48 px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
							>
								<option value="daily">
									{t(RestaurantsKeys.FORM_ORDER_NUMBER_RESET_OPTION_DAILY)}
								</option>
								<option value="weekly">
									{t(RestaurantsKeys.FORM_ORDER_NUMBER_RESET_OPTION_WEEKLY)}
								</option>
								<option value="biweekly">
									{t(RestaurantsKeys.FORM_ORDER_NUMBER_RESET_OPTION_BIWEEKLY)}
								</option>
								<option value="monthly">
									{t(RestaurantsKeys.FORM_ORDER_NUMBER_RESET_OPTION_MONTHLY)}
								</option>
							</select>
							<p className="mt-1 text-xs text-faint-foreground max-w-lg">
								{t(RestaurantsKeys.FORM_ORDER_NUMBER_RESET_HINT)}
							</p>
						</div>
					)}
				/>
			)}

			{organizations && !isManagerSettings && organizations.length > 0 && (
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
								required
								className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
							>
								<option value="" disabled>
									{t(RestaurantsKeys.FORM_ORG_PLACEHOLDER)}
								</option>
								{organizations.map((org) => (
									<option key={org._id} value={org._id}>
										{org.name}
									</option>
								))}
							</select>
						</div>
					)}
				/>
			)}

			<button
				type="submit"
				disabled={isSaving}
				className="px-6 py-2 rounded-lg text-sm font-medium hover-btn-primary"
			>
				{restaurant
					? t(RestaurantsKeys.FORM_SAVE_CHANGES)
					: t(RestaurantsKeys.MODAL_CREATE_HEADING)}
			</button>
		</form>
	);
}
