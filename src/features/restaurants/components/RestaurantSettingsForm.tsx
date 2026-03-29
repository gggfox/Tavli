import { sanitizeSlug } from "@/global/utils/slug";
import { useForm } from "@tanstack/react-form";
import type { Doc, Id } from "convex/_generated/dataModel";
import { ExternalLink, ToggleLeft, ToggleRight } from "lucide-react";

interface RestaurantSettingsFormProps {
	restaurant: Doc<"restaurants"> | null;
	organizations?: Doc<"organizations">[];
	onSave: (data: {
		name: string;
		slug: string;
		description?: string;
		currency: string;
		timezone?: string;
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
	const form = useForm({
		defaultValues: {
			name: restaurant?.name ?? "",
			slug: restaurant?.slug ?? "",
			description: restaurant?.description ?? "",
			currency: restaurant?.currency ?? "USD",
			timezone: restaurant?.timezone ?? "",
			organizationId: (restaurant?.organizationId as string) ?? "",
		},
		onSubmit: async ({ value }) => {
			await onSave({
				name: value.name,
				slug: value.slug,
				description: value.description || undefined,
				currency: value.currency,
				timezone: value.timezone || undefined,
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
					className="flex items-center justify-between px-4 py-3 rounded-lg"
					style={{
						backgroundColor: "var(--bg-secondary)",
						border: "1px solid var(--border-default)",
					}}
				>
					<div className="flex items-center gap-3">
						<span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
							Status
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
							{restaurant.isActive ? "Active" : "Inactive"}
						</span>
					</div>
					<button
						type="button"
						onClick={() => onToggleActive?.(restaurant._id)}
						className="p-1.5 rounded-md hover:bg-[var(--bg-hover)]"
						title={restaurant.isActive ? "Deactivate restaurant" : "Activate restaurant"}
					>
						{restaurant.isActive ? (
							<ToggleRight size={24} style={{ color: "var(--accent-success)" }} />
						) : (
							<ToggleLeft size={24} style={{ color: "var(--text-muted)" }} />
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
							className="block text-sm font-medium mb-1"
							style={{ color: "var(--text-primary)" }}
						>
							Restaurant Name
						</label>
						<input
							id="restaurant-name"
							type="text"
							value={field.state.value}
							onChange={(e) => field.handleChange(e.target.value)}
							onBlur={field.handleBlur}
							required
							className="w-full px-3 py-2 rounded-lg text-sm"
							style={{
								backgroundColor: "var(--bg-secondary)",
								border: "1px solid var(--border-default)",
								color: "var(--text-primary)",
							}}
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
							className="block text-sm font-medium mb-1"
							style={{ color: "var(--text-primary)" }}
						>
							Slug (URL identifier)
						</label>
						<input
							id="restaurant-slug"
							type="text"
							value={field.state.value}
							onChange={(e) => field.handleChange(sanitizeSlug(e.target.value))}
							onBlur={field.handleBlur}
							required
							className="w-full px-3 py-2 rounded-lg text-sm"
							style={{
								backgroundColor: "var(--bg-secondary)",
								border: "1px solid var(--border-default)",
								color: "var(--text-primary)",
							}}
						/>
						<div className="flex items-center gap-2 mt-1">
							<p className="text-xs" style={{ color: "var(--text-muted)" }}>
								Customers will visit: /r/{slugValue || "your-slug"}/en/menu
							</p>
							{restaurant && slugValue && (
								<a
									href={testUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded hover:bg-[var(--bg-hover)]"
									style={{ color: "var(--accent-primary)" }}
								>
									<ExternalLink size={12} />
									Open Test Link
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
							className="block text-sm font-medium mb-1"
							style={{ color: "var(--text-primary)" }}
						>
							Description
						</label>
						<textarea
							id="restaurant-desc"
							value={field.state.value}
							onChange={(e) => field.handleChange(e.target.value)}
							onBlur={field.handleBlur}
							rows={3}
							className="w-full px-3 py-2 rounded-lg text-sm"
							style={{
								backgroundColor: "var(--bg-secondary)",
								border: "1px solid var(--border-default)",
								color: "var(--text-primary)",
							}}
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
								className="block text-sm font-medium mb-1"
								style={{ color: "var(--text-primary)" }}
							>
								Currency
							</label>
							<select
								id="restaurant-currency"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								className="w-full px-3 py-2 rounded-lg text-sm"
								style={{
									backgroundColor: "var(--bg-secondary)",
									border: "1px solid var(--border-default)",
									color: "var(--text-primary)",
								}}
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
								className="block text-sm font-medium mb-1"
								style={{ color: "var(--text-primary)" }}
							>
								Timezone
							</label>
							<input
								id="restaurant-tz"
								type="text"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								placeholder="America/New_York"
								className="w-full px-3 py-2 rounded-lg text-sm"
								style={{
									backgroundColor: "var(--bg-secondary)",
									border: "1px solid var(--border-default)",
									color: "var(--text-primary)",
								}}
							/>
						</div>
					)}
				/>
			</div>

			{organizations && organizations.length > 0 && (
				<form.Field
					name="organizationId"
					children={(field) => (
						<div>
							<label
								htmlFor="restaurant-org"
								className="block text-sm font-medium mb-1"
								style={{ color: "var(--text-primary)" }}
							>
								Organization
							</label>
							<select
								id="restaurant-org"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								required
								className="w-full px-3 py-2 rounded-lg text-sm"
								style={{
									backgroundColor: "var(--bg-secondary)",
									border: "1px solid var(--border-default)",
									color: "var(--text-primary)",
								}}
							>
								<option value="" disabled>
									Select an organization
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
				{restaurant ? "Save Changes" : "Create Restaurant"}
			</button>
		</form>
	);
}
