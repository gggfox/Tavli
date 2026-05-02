import { RestaurantsKeys } from "@/global/i18n";
import { sanitizeSlug } from "@/global/utils/slug";
import { useForm } from "@tanstack/react-form";
import type { Doc, Id } from "convex/_generated/dataModel";
import { ExternalLink, ToggleLeft, ToggleRight } from "lucide-react";
import { useTranslation } from "react-i18next";

const DEFAULT_ORDER_DAY_START_MINUTES = 240;

function minutesToTimeInput(totalMinutes: number): string {
	const m = Math.min(1439, Math.max(0, totalMinutes));
	const h = Math.floor(m / 60);
	const min = m % 60;
	return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
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
		timezone?: string;
		orderDayStartMinutesFromMidnight: number;
		organizationId: Id<"organizations">;
	}) => Promise<unknown>;
	onToggleActive?: (restaurantId: Id<"restaurants">) => Promise<unknown>;
	isSaving?: boolean;
}

export function RestaurantSettingsForm({
	restaurant,
	organizations,
	onSave,
	onToggleActive,
	isSaving,
}: Readonly<RestaurantSettingsFormProps>) {
	const { t } = useTranslation();
	const form = useForm({
		defaultValues: {
			name: restaurant?.name ?? "",
			slug: restaurant?.slug ?? "",
			description: restaurant?.description ?? "",
			currency: restaurant?.currency ?? "USD",
			timezone: restaurant?.timezone ?? "",
			orderDayStartTime: minutesToTimeInput(
				restaurant?.orderDayStartMinutesFromMidnight ?? DEFAULT_ORDER_DAY_START_MINUTES
			),
			organizationId: (restaurant?.organizationId as string) ?? "",
		},
		onSubmit: async ({ value }) => {
			await onSave({
				name: value.name,
				slug: value.slug,
				description: value.description || undefined,
				currency: value.currency,
				timezone: value.timezone || undefined,
				orderDayStartMinutesFromMidnight: timeInputToMinutes(value.orderDayStartTime),
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
			{restaurant && (
				<div
					className="flex items-center justify-between px-4 py-3 rounded-lg bg-muted border border-border"
					
				>
					<div className="flex items-center gap-3">
						<span className="text-sm font-medium text-foreground" >
							{t(RestaurantsKeys.FORM_STATUS_LABEL)}
						</span>
						<span
							className="text-xs px-2 py-0.5 rounded-full font-medium"
							style={{backgroundColor: restaurant.isActive
									? "var(--accent-success)"
									: "var(--bg-tertiary)",
				color: restaurant.isActive ? "white" : "var(--text-muted)"}}
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
							<ToggleRight size={24}  />
						) : (
							<ToggleLeft size={24} className="text-faint-foreground"  />
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
							<p className="text-xs text-faint-foreground" >
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
					children={(field) => (
						<div>
							<label
								htmlFor="restaurant-tz"
								className="block text-sm font-medium mb-1 text-foreground"
								
							>
								{t(RestaurantsKeys.FORM_TIMEZONE_LABEL)}
							</label>
							<input
								id="restaurant-tz"
								type="text"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								placeholder={t(RestaurantsKeys.FORM_TIMEZONE_PLACEHOLDER)}
								className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
								
							/>
							{restaurant && !field.state.value.trim() && (
								<p className="mt-1 text-xs text-amber-700 dark:text-amber-400/90">
									{t(RestaurantsKeys.FORM_TIMEZONE_MISSING_HINT)}
								</p>
							)}
						</div>
					)}
				/>
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
						<p className="mt-1 text-xs text-faint-foreground max-w-lg">
							{t(RestaurantsKeys.FORM_ORDER_DAY_START_HINT)}
						</p>
					</div>
				)}
			/>

			{organizations && organizations.length > 0 && (
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
