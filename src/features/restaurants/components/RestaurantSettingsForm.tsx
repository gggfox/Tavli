import type { Doc, Id } from "convex/_generated/dataModel";
import { ExternalLink, ToggleLeft, ToggleRight } from "lucide-react";
import { useState } from "react";

interface RestaurantSettingsFormProps {
	restaurant: Doc<"restaurants"> | null;
	onSave: (data: {
		name: string;
		slug: string;
		description?: string;
		currency: string;
		timezone?: string;
	}) => Promise<unknown>;
	onToggleActive?: (restaurantId: Id<"restaurants">) => Promise<unknown>;
	isSaving?: boolean;
}

export function RestaurantSettingsForm({
	restaurant,
	onSave,
	onToggleActive,
	isSaving,
}: Readonly<RestaurantSettingsFormProps>) {
	const [name, setName] = useState(restaurant?.name ?? "");
	const [slug, setSlug] = useState(restaurant?.slug ?? "");
	const [description, setDescription] = useState(restaurant?.description ?? "");
	const [currency, setCurrency] = useState(restaurant?.currency ?? "USD");
	const [timezone, setTimezone] = useState(restaurant?.timezone ?? "");

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		await onSave({
			name,
			slug,
			description: description || undefined,
			currency,
			timezone: timezone || undefined,
		});
	};

	const testUrl = `/r/${slug || "your-slug"}/t/1/menu`;

	return (
		<form onSubmit={handleSubmit} className="space-y-6 max-w-lg">
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
					value={name}
					onChange={(e) => setName(e.target.value)}
					required
					className="w-full px-3 py-2 rounded-lg text-sm"
					style={{
						backgroundColor: "var(--bg-secondary)",
						border: "1px solid var(--border-default)",
						color: "var(--text-primary)",
					}}
				/>
			</div>

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
					value={slug}
					onChange={(e) => setSlug(e.target.value.toLowerCase().replaceAll(/[^a-z0-9-]/g, "-"))}
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
						Customers will visit: /r/{slug || "your-slug"}/t/1
					</p>
					{restaurant && slug && (
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
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					rows={3}
					className="w-full px-3 py-2 rounded-lg text-sm"
					style={{
						backgroundColor: "var(--bg-secondary)",
						border: "1px solid var(--border-default)",
						color: "var(--text-primary)",
					}}
				/>
			</div>

			<div className="grid grid-cols-2 gap-4">
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
						value={currency}
						onChange={(e) => setCurrency(e.target.value)}
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
						value={timezone}
						onChange={(e) => setTimezone(e.target.value)}
						placeholder="America/New_York"
						className="w-full px-3 py-2 rounded-lg text-sm"
						style={{
							backgroundColor: "var(--bg-secondary)",
							border: "1px solid var(--border-default)",
							color: "var(--text-primary)",
						}}
					/>
				</div>
			</div>

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
