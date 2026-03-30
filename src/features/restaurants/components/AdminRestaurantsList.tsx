import { RestaurantSettingsForm } from "@/features/restaurants/components/RestaurantSettingsForm";
import { StripeConnectSetup } from "@/features/restaurants/components/StripeConnectSetup";
import { TablesManager } from "@/features/restaurants/components/TablesManager";
import {
	EmptyState,
	InlineError,
	LoadingState,
	Modal,
	StatusBadge,
	TextInput,
} from "@/global/components";
import { sanitizeSlug, unwrapQuery, unwrapResult } from "@/global/utils";
import { convexQuery, useConvexAuth, useConvexMutation } from "@convex-dev/react-query";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { ExternalLink, LayoutGrid, Pencil, Plus, ToggleLeft, ToggleRight, X } from "lucide-react";
import { useMemo, useState } from "react";

function useOrganizations() {
	const { isAuthenticated } = useConvexAuth();
	const { data: raw } = useQuery({
		...convexQuery(api.organizations.getAllOrganizations, {}),
		enabled: isAuthenticated,
	});
	return unwrapQuery(raw).data ?? [];
}

type ModalState =
	| { kind: "closed" }
	| { kind: "create" }
	| { kind: "edit"; restaurant: Doc<"restaurants"> }
	| { kind: "tables"; restaurant: Doc<"restaurants"> };

export function AdminRestaurantsList() {
	const { isAuthenticated } = useConvexAuth();
	const organizations = useOrganizations();

	const { data: rawUserRoles } = useQuery({
		...convexQuery(api.admin.getCurrentUserRoles, {}),
		enabled: isAuthenticated,
	});
	const userRoles: string[] = useMemo(() => unwrapQuery(rawUserRoles).data ?? [], [rawUserRoles]);
	const canManage = useMemo(
		() => userRoles.includes("admin") || userRoles.includes("owner"),
		[userRoles]
	);

	const { data: rawResult, isLoading } = useQuery({
		...convexQuery(api.restaurants.getAll, {}),
		enabled: isAuthenticated,
	});
	const { data, error: queryError } = unwrapQuery(rawResult);
	const restaurants = data ?? [];

	const updateMutation = useMutation({
		mutationFn: useConvexMutation(api.restaurants.update),
	});
	const toggleActiveMutation = useMutation({
		mutationFn: useConvexMutation(api.restaurants.toggleActive),
	});

	const [modal, setModal] = useState<ModalState>({ kind: "closed" });
	const [error, setError] = useState<string | null>(null);

	const closeModal = () => setModal({ kind: "closed" });

	if (isLoading) {
		return <LoadingState />;
	}

	return (
		<div className="space-y-4">
			{queryError && <InlineError message={queryError.message ?? "Failed to load restaurants."} />}
			{error && <InlineError message={error} onDismiss={() => setError(null)} />}

			{canManage && (
				<div className="flex justify-end">
					<button
						onClick={() => setModal({ kind: "create" })}
						className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
					>
						<Plus size={16} />
						New Restaurant
					</button>
				</div>
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
							{canManage && (
								<button
									onClick={() => setModal({ kind: "edit", restaurant: r })}
									className="p-1.5 rounded-md hover:bg-[var(--bg-hover)]"
									title="Edit restaurant"
								>
									<Pencil size={16} style={{ color: "var(--text-secondary)" }} />
								</button>
							)}
							{canManage && (
								<button
									onClick={() => setModal({ kind: "tables", restaurant: r })}
									className="p-1.5 rounded-md hover:bg-[var(--bg-hover)]"
									title="Manage tables"
								>
									<LayoutGrid size={16} style={{ color: "var(--text-secondary)" }} />
								</button>
							)}
							<a
								href={`/r/${r.slug}/en/menu`}
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
							{canManage && (
								<button
									onClick={async () => {
										try {
											unwrapResult(
												await toggleActiveMutation.mutateAsync({
													restaurantId: r._id as Id<"restaurants">,
												})
											);
										} catch (err) {
											setError(
												err instanceof Error ? err.message : "Failed to toggle restaurant status"
											);
										}
									}}
									className="p-1.5 rounded-md hover:bg-[var(--bg-hover)]"
									title={r.isActive ? "Deactivate" : "Activate"}
								>
									{r.isActive ? (
										<ToggleRight size={20} style={{ color: "var(--accent-success)" }} />
									) : (
										<ToggleLeft size={20} style={{ color: "var(--text-muted)" }} />
									)}
								</button>
							)}
						</div>
					</div>
				))}
				{restaurants.length === 0 && <EmptyState variant="inline" title="No restaurants found." />}
			</div>

			{/* Create Modal */}
			<Modal
				isOpen={modal.kind === "create"}
				onClose={closeModal}
				ariaLabel="Create Restaurant"
				size="md"
			>
				<div
					className="p-6 rounded-xl"
					style={{
						backgroundColor: "var(--bg-primary)",
						border: "1px solid var(--border-default)",
					}}
				>
					<div className="flex items-center justify-between mb-6">
						<h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
							New Restaurant
						</h2>
						<button onClick={closeModal} className="p-1.5 rounded-md hover:bg-[var(--bg-hover)]">
							<X size={20} style={{ color: "var(--text-muted)" }} />
						</button>
					</div>
					<CreateRestaurantForm onCreated={closeModal} onError={setError} />
				</div>
			</Modal>

			{/* Edit Modal */}
			{modal.kind === "edit" && (
				<Modal isOpen onClose={closeModal} ariaLabel="Edit Restaurant" size="lg">
					<div
						className="p-6 rounded-xl"
						style={{
							backgroundColor: "var(--bg-primary)",
							border: "1px solid var(--border-default)",
						}}
					>
						<div className="flex items-center justify-between mb-6">
							<h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
								Edit Restaurant
							</h2>
							<button onClick={closeModal} className="p-1.5 rounded-md hover:bg-[var(--bg-hover)]">
								<X size={20} style={{ color: "var(--text-muted)" }} />
							</button>
						</div>
						<RestaurantSettingsForm
							restaurant={modal.restaurant}
							organizations={organizations}
							onSave={async (data) => {
								try {
									unwrapResult(
										await updateMutation.mutateAsync({
											restaurantId: modal.restaurant._id,
											...data,
										})
									);
									closeModal();
								} catch (err) {
									setError(err instanceof Error ? err.message : "Failed to update restaurant");
								}
							}}
							onToggleActive={async (restaurantId) => {
								try {
									unwrapResult(await toggleActiveMutation.mutateAsync({ restaurantId }));
								} catch (err) {
									setError(
										err instanceof Error ? err.message : "Failed to toggle restaurant status"
									);
								}
							}}
							isSaving={updateMutation.isPending}
						/>
						<div className="mt-6">
							<StripeConnectSetup restaurantId={modal.restaurant._id} />
						</div>
					</div>
				</Modal>
			)}

			{/* Tables Modal */}
			{modal.kind === "tables" && (
				<Modal isOpen onClose={closeModal} ariaLabel="Manage Tables" size="xl">
					<div
						className="p-6 rounded-xl"
						style={{
							backgroundColor: "var(--bg-primary)",
							border: "1px solid var(--border-default)",
						}}
					>
						<div className="flex items-center justify-between mb-6">
							<div>
								<h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
									Tables
								</h2>
								<p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
									{modal.restaurant.name}
								</p>
							</div>
							<button onClick={closeModal} className="p-1.5 rounded-md hover:bg-[var(--bg-hover)]">
								<X size={20} style={{ color: "var(--text-muted)" }} />
							</button>
						</div>
						<TablesManager restaurantId={modal.restaurant._id} />
					</div>
				</Modal>
			)}
		</div>
	);
}

function CreateRestaurantForm({
	onCreated,
	onError,
}: {
	onCreated: () => void;
	onError: (msg: string) => void;
}) {
	const createMutation = useMutation({
		mutationFn: useConvexMutation(api.restaurants.create),
	});
	const organizations = useOrganizations();

	const form = useForm({
		defaultValues: { name: "", slug: "", currency: "USD", organizationId: "" },
		onSubmit: async ({ value }) => {
			try {
				unwrapResult(
					await createMutation.mutateAsync({
						name: value.name,
						slug: value.slug,
						currency: value.currency,
						organizationId: value.organizationId as Id<"organizations">,
					})
				);
				onCreated();
			} catch (err) {
				onError(err instanceof Error ? err.message : "Failed to create restaurant");
			}
		},
	});

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				e.stopPropagation();
				form.handleSubmit();
			}}
			className="space-y-4"
		>
			<form.Field
				name="name"
				children={(field) => (
					<TextInput
						id="admin-rest-name"
						label="Name"
						type="text"
						value={field.state.value}
						onChange={(e) => field.handleChange(e.target.value)}
						onBlur={field.handleBlur}
						required
					/>
				)}
			/>
			<form.Field
				name="slug"
				children={(field) => (
					<TextInput
						id="admin-rest-slug"
						label="Slug"
						type="text"
						value={field.state.value}
						onChange={(e) => field.handleChange(sanitizeSlug(e.target.value))}
						onBlur={field.handleBlur}
						required
					/>
				)}
			/>
			<form.Field
				name="currency"
				children={(field) => (
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
							<option value="EUR">EUR</option>
							<option value="GBP">GBP</option>
							<option value="MXN">MXN ($)</option>
						</select>
					</div>
				)}
			/>
			<form.Field
				name="organizationId"
				children={(field) => (
					<div>
						<label
							htmlFor="admin-rest-org"
							className="block text-xs font-medium mb-1"
							style={{ color: "var(--text-secondary)" }}
						>
							Organization
						</label>
						<select
							id="admin-rest-org"
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
			<div className="flex gap-2 pt-2">
				<form.Subscribe
					selector={(state) => state.isSubmitting}
					children={(isSubmitting) => (
						<button
							type="submit"
							disabled={isSubmitting}
							className="px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
						>
							{isSubmitting ? "Creating..." : "Create"}
						</button>
					)}
				/>
			</div>
		</form>
	);
}
