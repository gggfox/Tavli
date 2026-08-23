import { SettingsSection } from "@/features/restaurants/components/settings/SettingsSection";
import { SettingsSectionFooter } from "@/features/restaurants/components/settings/SettingsSectionFooter";
import type { RestaurantSettingsSectionProps } from "@/features/restaurants/components/settings/types";
import { RestaurantsKeys } from "@/global/i18n";
import { isValidIanaTimezone } from "@/global/utils/timezone";
import { useForm } from "@tanstack/react-form";
import { DEFAULT_RESTAURANT_TIMEZONE } from "convex/constants";
import { useTranslation } from "react-i18next";

export const DEFAULT_ORDER_DAY_START_MINUTES = 240;

type OrderNumberResetFrequency = "daily" | "weekly" | "biweekly" | "monthly";

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

export function minutesToTimeInput(totalMinutes: number): string {
	const m = Math.min(1439, Math.max(0, totalMinutes));
	const h = Math.floor(m / 60);
	const min = m % 60;
	return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function timeInputToMinutes(s: string): number {
	const parts = s.split(":");
	const h = Number.parseInt(parts[0] ?? "0", 10);
	const min = Number.parseInt(parts[1] ?? "0", 10);
	if (Number.isNaN(h) || Number.isNaN(min)) return DEFAULT_ORDER_DAY_START_MINUTES;
	return Math.min(1439, Math.max(0, h * 60 + min));
}

interface HoursSectionProps extends RestaurantSettingsSectionProps {
	/**
	 * Order-number reset cadence is still a platform-admin experiment knob
	 * (`restaurants.update` rejects the change for anyone else).
	 */
	readonly canEditOrderNumberReset: boolean;
}

export function HoursSection({
	restaurant,
	onSave,
	isSaving,
	isSaved,
	error,
	onDismissError,
	canEditOrderNumberReset,
}: Readonly<HoursSectionProps>) {
	const { t } = useTranslation();

	const form = useForm({
		defaultValues: {
			timezone: restaurant.timezone ?? DEFAULT_RESTAURANT_TIMEZONE,
			openTime: restaurant.openTime ?? "10:00",
			closeTime: restaurant.closeTime ?? "23:00",
			orderDayStartTime: minutesToTimeInput(
				restaurant.orderDayStartMinutesFromMidnight ?? DEFAULT_ORDER_DAY_START_MINUTES
			),
			orderNumberResetFrequency:
				(restaurant.orderNumberResetFrequency as OrderNumberResetFrequency | undefined) ??
				DEFAULT_ORDER_NUMBER_RESET_FREQUENCY,
		},
		onSubmit: async ({ value }) => {
			const saved = await onSave({
				timezone: value.timezone,
				openTime: value.openTime,
				closeTime: value.closeTime,
				orderDayStartMinutesFromMidnight: timeInputToMinutes(value.orderDayStartTime),
				...(canEditOrderNumberReset && {
					orderNumberResetFrequency: value.orderNumberResetFrequency,
				}),
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
				testId="settings-section-hours"
				title={t(RestaurantsKeys.SETTINGS_HOURS_TITLE)}
				hint={t(RestaurantsKeys.SETTINGS_HOURS_HINT)}
				footer={
					<form.Subscribe
						selector={(state) => state.isDefaultValue}
						children={(isDefaultValue) => (
							<SettingsSectionFooter
								testId="settings-save-hours"
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
					name="timezone"
					children={(field) => {
						const selectValue = timezoneSelectValue(field.state.value);
						const showCustom = selectValue === TIMEZONE_OTHER;
						return (
							<div className="max-w-sm">
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

				<div>
					<div className="grid grid-cols-2 gap-4 max-w-sm">
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
					<p className="mt-1 text-xs text-faint-foreground">
						{t(RestaurantsKeys.FORM_OPERATING_HOURS_HINT)}
					</p>
				</div>

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
							<p className="mt-1 text-xs text-faint-foreground">
								{t(RestaurantsKeys.FORM_ORDER_DAY_START_HINT)}
							</p>
						</div>
					)}
				/>

				{canEditOrderNumberReset ? (
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
								<p className="mt-1 text-xs text-faint-foreground">
									{t(RestaurantsKeys.FORM_ORDER_NUMBER_RESET_HINT)}
								</p>
							</div>
						)}
					/>
				) : null}
			</SettingsSection>
		</form>
	);
}
