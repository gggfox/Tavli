import { EmptyState, InlineError, LoadingState, StatusBadge, TextInput } from "@/global/components";
import { unwrapResult } from "@/global/utils";
import { convexQuery, useConvexAuth, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { ExternalLink, Plus, ToggleLeft, ToggleRight } from "lucide-react";
import { useState } from "react";

export function AdminRestaurantsList() {
	const { isAuthenticated } = useConvexAuth();

	const { data: rawResult, isLoading } = useQuery({
		...convexQuery(api.restaurants.getAll, {}),
		enabled: isAuthenticated,
	});
	const restaurants = Array.isArray(rawResult) && rawResult[0] ? rawResult[0] : [];
	const queryError = Array.isArray(rawResult) && rawResult[1] ? rawResult[1] : null;

	const createMutation = useMutation({
		mutationFn: useConvexMutation(api.restaurants.create),
	});
	const toggleActiveMutation = useMutation({
		mutationFn: useConvexMutation(api.restaurants.toggleActive),
	});

	const [showForm, setShowForm] = useState(false);
	const [name, setName] = useState("");
	const [slug, setSlug] = useState("");
	const [currency, setCurrency] = useState("USD");
	const [error, setError] = useState<string | null>(null);

	const handleCreate = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		try {
			unwrapResult(await createMutation.mutateAsync({ name, slug, currency }));
			setName("");
			setSlug("");
			setCurrency("USD");
			setShowForm(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create restaurant");
		}
	};

	if (isLoading) {
		return <LoadingState />;
	}

	return (
		<div className="space-y-4">
			{queryError && <InlineError message={queryError.message ?? "Failed to load restaurants."} />}
			{error && <InlineError message={error} onDismiss={() => setError(null)} />}

			<div className="flex justify-end">
				<button
					onClick={() => setShowForm(!showForm)}
					className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
				>
					<Plus size={16} />
					New Restaurant
				</button>
			</div>

			{showForm && (
				<form
					onSubmit={handleCreate}
					className="p-4 rounded-lg space-y-3"
					style={{
						backgroundColor: "var(--bg-secondary)",
						border: "1px solid var(--border-default)",
					}}
				>
					<div className="grid grid-cols-3 gap-3">
						<TextInput
							id="admin-rest-name"
							label="Name"
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
						/>
						<TextInput
							id="admin-rest-slug"
							label="Slug"
							type="text"
							value={slug}
							onChange={(e) => setSlug(e.target.value.toLowerCase().replaceAll(/[^a-z0-9-]/g, "-"))}
							required
						/>
						<div>
							<label
								htmlFor="admin-rest-currency"
								className="block text-xs font-medium mb-1"
								style={{ color: "var(--text-secondary)" }}
							>
								Currency
							</label>
							<select
								id="admin-rest-currency"
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
								<option value="EUR">EUR</option>
								<option value="GBP">GBP</option>
								<option value="MXN">MXN ($)</option>
							</select>
						</div>
					</div>
					<div className="flex gap-2">
						<button
							type="submit"
							className="px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
						>
							Create
						</button>
						<button
							type="button"
							onClick={() => setShowForm(false)}
							className="px-4 py-2 rounded-lg text-sm font-medium"
							style={{ color: "var(--text-secondary)" }}
						>
							Cancel
						</button>
					</div>
				</form>
			)}

			<div className="space-y-2">
				{restaurants.map((r) => (
					<div
						key={r._id}
						className="flex items-center justify-between px-4 py-3 rounded-lg"
						style={{
							backgroundColor: "var(--bg-secondary)",
							border: "1px solid var(--border-default)",
						}}
					>
						<div className="flex items-center gap-4">
							<div>
								<span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
									{r.name}
								</span>
								<span className="text-xs ml-2" style={{ color: "var(--text-muted)" }}>
									/{r.slug}
								</span>
							</div>
							<StatusBadge
								bgColor={r.isActive ? "var(--accent-success)" : "var(--bg-tertiary)"}
								textColor={r.isActive ? "white" : "var(--text-muted)"}
								label={r.isActive ? "Active" : "Inactive"}
							/>
							<span className="text-xs" style={{ color: "var(--text-muted)" }}>
								{r.currency}
							</span>
						</div>
						<div className="flex items-center gap-2">
							<a
								href={`/r/${r.slug}/t/1/menu`}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-[var(--bg-hover)]"
								style={{
									color: "var(--accent-primary)",
									border: "1px solid var(--border-default)",
								}}
							>
								<ExternalLink size={14} />
								Customer View
							</a>
							<button
								onClick={() =>
									toggleActiveMutation.mutateAsync({
										restaurantId: r._id as Id<"restaurants">,
									})
								}
								className="p-1.5 rounded-md hover:bg-[var(--bg-hover)]"
								title={r.isActive ? "Deactivate" : "Activate"}
							>
								{r.isActive ? (
									<ToggleRight size={20} style={{ color: "var(--accent-success)" }} />
								) : (
									<ToggleLeft size={20} style={{ color: "var(--text-muted)" }} />
								)}
							</button>
						</div>
					</div>
				))}
				{restaurants.length === 0 && <EmptyState variant="inline" title="No restaurants found." />}
			</div>
		</div>
	);
}
