import { AdminRestaurantsListSkeleton } from "@/features/restaurants/components/AdminRestaurantsListSkeleton";
import { RestaurantSettingsForm } from "@/features/restaurants/components/RestaurantSettingsForm";
import { StripeConnectSetup } from "@/features/restaurants/components/StripeConnectSetup";
import { TablesManager } from "@/features/restaurants/components/TablesManager";
import { useCurrentUserRoles } from "@/features/users/hooks";
import { EmptyState, InlineError, Modal, StatusBadge, TextInput } from "@/global/components";
import { RestaurantsKeys } from "@/global/i18n";
import { sanitizeSlug, unwrapResult, type UnwrappedValue } from "@/global/utils";
import { convexQuery, useConvexAuth, useConvexMutation } from "@convex-dev/react-query";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Doc, Id } from "convex/_generated/dataModel";
import { ExternalLink, LayoutGrid, Pencil, Plus, ToggleLeft, ToggleRight, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type OrganizationsValue = UnwrappedValue<
	FunctionReturnType<typeof api.organizations.getAllOrganizations>
>;
type RestaurantsValue = UnwrappedValue<FunctionReturnType<typeof api.restaurants.getAll>>;

function useOrganizations() {
	const { isAuthenticated } = useConvexAuth();
	const { data = [] } = useQuery({
		...convexQuery(api.organizations.getAllOrganizations, {}),
		enabled: isAuthenticated,
		select: unwrapResult<OrganizationsValue>,
	});
	return data;
}

type ModalState =
	| { kind: "closed" }
	| { kind: "create" }
	| { kind: "edit"; restaurant: Doc<"restaurants"> }
	| { kind: "tables"; restaurant: Doc<"restaurants"> };

export function AdminRestaurantsList() {
	const { t } = useTranslation();
	const { isAuthenticated } = useConvexAuth();
	const organizations = useOrganizations();

	const { roles: userRoles } = useCurrentUserRoles();
	const canManage = useMemo(
		() => userRoles.includes("admin") || userRoles.includes("owner"),
		[userRoles]
	);

	const { data: restaurants = [], isLoading, error: queryError } = useQuery({
		...convexQuery(api.restaurants.getAll, {}),
		enabled: isAuthenticated,
		select: unwrapResult<RestaurantsValue>,
	});

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
		return <AdminRestaurantsListSkeleton />;
	}

	return (
		<div className="space-y-4">
			{queryError && (
				<InlineError message={queryError.message ?? t(RestaurantsKeys.LIST_LOAD_FAILED)} />
			)}
			{error && <InlineError message={error} onDismiss={() => setError(null)} />}

			{canManage && (
				<div className="flex justify-end">
					<button
						onClick={() => setModal({ kind: "create" })}
						className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
					>
						<Plus size={16} />
						{t(RestaurantsKeys.LIST_NEW_RESTAURANT)}
					</button>
				</div>
			)}

			<div className="space-y-2">
				{restaurants.map((r) => (
					<div
						key={r._id}
						className="flex items-center justify-between px-4 py-3 rounded-lg bg-muted border border-border"
						
					>
						<div className="flex items-center gap-4">
							<div>
								<span className="text-sm font-medium text-foreground" >
									{r.name}
								</span>
								<span className="text-xs ml-2 text-faint-foreground" >
									/{r.slug}
								</span>
							</div>
							<StatusBadge
								bgColor={r.isActive ? "var(--accent-success)" : "var(--bg-tertiary)"}
								textColor={r.isActive ? "white" : "var(--text-muted)"}
								label={
									r.isActive
										? t(RestaurantsKeys.LIST_STATUS_ACTIVE)
										: t(RestaurantsKeys.LIST_STATUS_INACTIVE)
								}
							/>
							<span className="text-xs text-faint-foreground" >
								{r.currency}
							</span>
						</div>
						<div className="flex items-center gap-2">
							{canManage && (
								<button
									onClick={() => setModal({ kind: "edit", restaurant: r })}
									className="p-1.5 rounded-md hover:bg-hover text-muted-foreground"
									title={t(RestaurantsKeys.LIST_EDIT)}
								>
									<Pencil size={16}  />
								</button>
							)}
							{canManage && (
								<button
									onClick={() => setModal({ kind: "tables", restaurant: r })}
									className="p-1.5 rounded-md hover:bg-hover text-muted-foreground"
									title={t(RestaurantsKeys.LIST_MANAGE_TABLES)}
								>
									<LayoutGrid size={16}  />
								</button>
							)}
							<a
								href={`/r/${r.slug}/en/menu`}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-hover text-accent border border-border"
								
							>
								<ExternalLink size={14} />
								{t(RestaurantsKeys.LIST_CUSTOMER_VIEW)}
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
												err instanceof Error
													? err.message
													: t(RestaurantsKeys.LIST_TOGGLE_FAILED)
											);
										}
									}}
									className="p-1.5 rounded-md hover:bg-hover text-success"
									title={
										r.isActive
											? t(RestaurantsKeys.LIST_DEACTIVATE)
											: t(RestaurantsKeys.LIST_ACTIVATE)
									}
								>
									{r.isActive ? (
										<ToggleRight size={20}  />
									) : (
										<ToggleLeft size={20} className="text-faint-foreground"  />
									)}
								</button>
							)}
						</div>
					</div>
				))}
				{restaurants.length === 0 && (
					<EmptyState variant="inline" title={t(RestaurantsKeys.LIST_EMPTY)} />
				)}
			</div>

			{/* Create Modal */}
			<Modal
				isOpen={modal.kind === "create"}
				onClose={closeModal}
				ariaLabel={t(RestaurantsKeys.MODAL_CREATE_ARIA)}
				size="md"
			>
				<div
					className="p-6 rounded-xl bg-background border border-border"
					
				>
					<div className="flex items-center justify-between mb-6">
						<h2 className="text-xl font-semibold text-foreground" >
							{t(RestaurantsKeys.MODAL_CREATE_HEADING)}
						</h2>
						<button onClick={closeModal} className="p-1.5 rounded-md hover:bg-hover text-faint-foreground">
							<X size={20}  />
						</button>
					</div>
					<CreateRestaurantForm onCreated={closeModal} onError={setError} />
				</div>
			</Modal>

			{/* Edit Modal */}
			{modal.kind === "edit" && (
				<Modal
					isOpen
					onClose={closeModal}
					ariaLabel={t(RestaurantsKeys.MODAL_EDIT_ARIA)}
					size="lg"
				>
					<div
						className="p-6 rounded-xl bg-background border border-border"
						
					>
						<div className="flex items-center justify-between mb-6">
							<h2 className="text-xl font-semibold text-foreground" >
								{t(RestaurantsKeys.MODAL_EDIT_HEADING)}
							</h2>
							<button onClick={closeModal} className="p-1.5 rounded-md hover:bg-hover text-faint-foreground">
								<X size={20}  />
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
									setError(
										err instanceof Error ? err.message : t(RestaurantsKeys.FORM_UPDATE_FAILED)
									);
								}
							}}
							onToggleActive={async (restaurantId) => {
								try {
									unwrapResult(await toggleActiveMutation.mutateAsync({ restaurantId }));
								} catch (err) {
									setError(
										err instanceof Error ? err.message : t(RestaurantsKeys.LIST_TOGGLE_FAILED)
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
				<Modal
					isOpen
					onClose={closeModal}
					ariaLabel={t(RestaurantsKeys.MODAL_TABLES_ARIA)}
					size="xl"
				>
					<div
						className="p-6 rounded-xl bg-background border border-border"
						
					>
						<div className="flex items-center justify-between mb-6">
							<div>
								<h2 className="text-xl font-semibold text-foreground" >
									{t(RestaurantsKeys.MODAL_TABLES_HEADING)}
								</h2>
								<p className="text-sm mt-1 text-muted-foreground" >
									{modal.restaurant.name}
								</p>
							</div>
							<button onClick={closeModal} className="p-1.5 rounded-md hover:bg-hover text-faint-foreground">
								<X size={20}  />
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
	const { t } = useTranslation();
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
				onError(err instanceof Error ? err.message : t(RestaurantsKeys.FORM_CREATE_FAILED));
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
						label={t(RestaurantsKeys.FORM_NAME_LABEL)}
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
						label={t(RestaurantsKeys.FORM_SLUG_LABEL)}
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
							className="block text-xs font-medium mb-1 text-muted-foreground"
							
						>
							{t(RestaurantsKeys.FORM_CURRENCY_LABEL)}
						</label>
						<select
							id="admin-rest-currency"
							value={field.state.value}
							onChange={(e) => field.handleChange(e.target.value)}
							className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground"
							
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
							className="block text-xs font-medium mb-1 text-muted-foreground"
							
						>
							{t(RestaurantsKeys.FORM_ORG_LABEL)}
						</label>
						<select
							id="admin-rest-org"
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
			<div className="flex gap-2 pt-2">
				<form.Subscribe
					selector={(state) => state.isSubmitting}
					children={(isSubmitting) => (
						<button
							type="submit"
							disabled={isSubmitting}
							className="px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
						>
							{isSubmitting ? t(RestaurantsKeys.FORM_CREATING) : t(RestaurantsKeys.FORM_CREATE)}
						</button>
					)}
				/>
			</div>
		</form>
	);
}
