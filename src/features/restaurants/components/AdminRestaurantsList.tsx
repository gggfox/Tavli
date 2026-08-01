import { AdminRestaurantsListSkeleton } from "@/features/restaurants/components/AdminRestaurantsListSkeleton";
import { RestaurantManagersField } from "@/features/restaurants/components/RestaurantManagersField";
import { RestaurantSettingsForm } from "@/features/restaurants/components/RestaurantSettingsForm";
import { useRestaurant } from "@/features/restaurants/RestaurantAdminScope";
import { StripeConnectSetup } from "@/features/restaurants/components/StripeConnectSetup";
import { TablesManager } from "@/features/restaurants/components/TablesManager";
import { useCurrentUserRoles } from "@/features/users/hooks";
import { EmptyState, InlineError, Modal, StatusBadge, TextInput } from "@/global/components";
import { useIsTabletPortraitViewport } from "@/global/hooks";
import { RestaurantsKeys } from "@/global/i18n";
import { sanitizeSlug, unwrapResult, type UnwrappedValue } from "@/global/utils";
import { getErrorMessage } from "@/global/utils/errorMessages";
import { useUser } from "@clerk/tanstack-react-start";
import { convexQuery, useConvexAuth, useConvexMutation } from "@convex-dev/react-query";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Doc, Id } from "convex/_generated/dataModel";
import { DEFAULT_RESTAURANT_TIMEZONE, RESTAURANT_MEMBER_ROLE, USER_ROLES } from "convex/constants";
import {
	ChevronLeft,
	ExternalLink,
	LayoutGrid,
	Pencil,
	Plus,
	RotateCcw,
	ToggleLeft,
	ToggleRight,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type OrganizationsValue = UnwrappedValue<
	FunctionReturnType<typeof api.organizations.getAllOrganizations>
>;
type RestaurantsValue = UnwrappedValue<FunctionReturnType<typeof api.restaurants.getAll>>;
type DeletedRestaurantsValue = UnwrappedValue<
	FunctionReturnType<typeof api.restaurants.getDeletedForAdmin>
>;

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
	| { kind: "confirmDelete"; restaurant: Doc<"restaurants"> };

interface AdminRestaurantsListProps {
	/**
	 * The restaurant currently being managed (table editor expanded). When
	 * set, only that one restaurant's card is rendered. Lifted to the route
	 * so the route can drop the page header / action row from the layout.
	 */
	manageId?: Id<"restaurants"> | null;
	onManageChange?: (next: Id<"restaurants"> | null) => void;
}

export function AdminRestaurantsList({
	manageId,
	onManageChange,
}: Readonly<AdminRestaurantsListProps> = {}) {
	const { t } = useTranslation();
	const isTabletPortrait = useIsTabletPortraitViewport();
	const { isAuthenticated } = useConvexAuth();
	const { setSelectedRestaurantId } = useRestaurant();
	const organizations = useOrganizations();

	const { roles: userRoles, organizationId: userOrgId } = useCurrentUserRoles();
	const { user } = useUser();
	const canManage = useMemo(
		() => userRoles.includes(USER_ROLES.ADMIN) || userRoles.includes(USER_ROLES.OWNER),
		[userRoles]
	);

	const { data: myMemberships = [] } = useQuery({
		...convexQuery(api.restaurantMembers.listByUser, {}),
		enabled: isAuthenticated,
		select: unwrapResult<Doc<"restaurantMembers">[]>,
	});

	const canEditSettingsFor = useCallback(
		(restaurant: Doc<"restaurants">) => {
			if (canManage) return true;
			if (user?.id && restaurant.ownerId === user.id) return true;
			if (
				userRoles.includes(USER_ROLES.OWNER) &&
				userOrgId != null &&
				String(restaurant.organizationId) === userOrgId
			) {
				return true;
			}
			return myMemberships.some(
				(m) =>
					m.isActive &&
					m.restaurantId === restaurant._id &&
					m.role === RESTAURANT_MEMBER_ROLE.MANAGER
			);
		},
		[canManage, user?.id, userRoles, userOrgId, myMemberships]
	);

	const {
		data: restaurants = [],
		isLoading,
		error: queryError,
	} = useQuery({
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
	const softDeleteMutation = useMutation({
		mutationFn: useConvexMutation(api.restaurants.softDelete),
	});
	const restoreMutation = useMutation({
		mutationFn: useConvexMutation(api.restaurants.restore),
	});

	const [showTrash, setShowTrash] = useState(false);
	const [modal, setModal] = useState<ModalState>({ kind: "closed" });
	// `manageId` (the expanded "manage tables" view) is lifted to the route
	// so it can swap the page layout. The list mirrors it here when no
	// external controller wires up `onManageChange` (defensive fallback).
	const [internalExpandedId, setInternalExpandedId] = useState<Id<"restaurants"> | null>(null);
	const expandedTablesId = manageId !== undefined ? manageId : internalExpandedId;
	const setExpandedTablesId = (next: Id<"restaurants"> | null) => {
		if (onManageChange) {
			onManageChange(next);
		} else {
			setInternalExpandedId(next);
		}
	};
	const [error, setError] = useState<string | null>(null);

	const { data: deletedRestaurants = [], isLoading: deletedLoading } = useQuery({
		...convexQuery(api.restaurants.getDeletedForAdmin, {}),
		enabled: isAuthenticated && canManage && showTrash,
		select: unwrapResult<DeletedRestaurantsValue>,
	});

	const closeModal = () => setModal({ kind: "closed" });

	if (isLoading) {
		return <AdminRestaurantsListSkeleton />;
	}

	return (
		<div className="space-y-4">
			{queryError && (
				<InlineError message={getErrorMessage(queryError, t, RestaurantsKeys.LIST_LOAD_FAILED)} />
			)}
			{error && <InlineError message={error} onDismiss={() => setError(null)} />}

			{canManage && expandedTablesId === null && (
				<div className="flex flex-wrap justify-end gap-2">
					<button
						type="button"
						onClick={() => setShowTrash((v) => !v)}
						className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-hover text-foreground"
					>
						{showTrash ? t(RestaurantsKeys.LIST_HIDE_TRASH) : t(RestaurantsKeys.LIST_SHOW_TRASH)}
					</button>
					<button
						type="button"
						onClick={() => setModal({ kind: "create" })}
						className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium hover-btn-primary"
					>
						<Plus size={16} />
						{t(RestaurantsKeys.LIST_NEW_RESTAURANT)}
					</button>
				</div>
			)}

			{canManage && showTrash && (
				<div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
					<h3 className="text-sm font-semibold text-foreground">
						{t(RestaurantsKeys.TRASH_HEADING)}
					</h3>
					{deletedLoading ? (
						<p className="text-xs text-muted-foreground">{t(RestaurantsKeys.LIST_LOADING_ARIA)}</p>
					) : deletedRestaurants.length === 0 ? (
						<EmptyState variant="inline" title={t(RestaurantsKeys.TRASH_EMPTY)} />
					) : (
						<ul className="space-y-2">
							{deletedRestaurants.map((dr) => (
								<li
									key={dr._id}
									className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
								>
									<div className="min-w-0 space-y-0.5">
										<div className="font-medium text-foreground">{dr.name}</div>
										{dr.slugBeforeSoftDelete ? (
											<div className="text-xs text-muted-foreground">
												{t(RestaurantsKeys.TRASH_PUBLIC_SLUG, {
													slug: dr.slugBeforeSoftDelete,
												})}
											</div>
										) : null}
										{dr.deletedAt != null ? (
											<div className="text-xs text-faint-foreground">
												{t(RestaurantsKeys.TRASH_DELETED_AT, {
													date: new Date(dr.deletedAt).toLocaleString(),
												})}
											</div>
										) : null}
										{dr.deletedBy ? (
											<div className="text-xs text-faint-foreground">
												{t(RestaurantsKeys.TRASH_DELETED_BY, { userId: dr.deletedBy })}
											</div>
										) : null}
									</div>
									<button
										type="button"
										onClick={async () => {
											try {
												unwrapResult(await restoreMutation.mutateAsync({ restaurantId: dr._id }));
											} catch (err) {
												setError(getErrorMessage(err, t, RestaurantsKeys.LIST_RESTORE_FAILED));
											}
										}}
										disabled={restoreMutation.isPending}
										className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-hover"
									>
										<RotateCcw size={14} />
										{t(RestaurantsKeys.TRASH_RESTORE)}
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			)}

			<div className="space-y-2">
				{restaurants.map((r) => {
					const isExpanded = expandedTablesId === r._id;
					if (expandedTablesId !== null && !isExpanded) return null;
					if (isExpanded) {
						return (
							<ExpandedTablesRow
								key={r._id}
								restaurant={r}
								onClose={() => setExpandedTablesId(null)}
							/>
						);
					}
					return (
						<div
							key={r._id}
							// Stacked below sm: the identity block (fixed w-40) and the rigid
							// action row together exceed a 390px phone, and with
							// justify-between they collided instead of wrapping (TAVLI-4
							// device audit).
							className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-4 py-3 rounded-lg bg-muted border border-border"
						>
							<div className="flex items-center gap-4 min-w-0">
								<div className="w-40 shrink-0 min-w-0">
									<div className="text-sm font-medium text-foreground truncate">{r.name}</div>
									<div className="text-xs text-faint-foreground truncate">/{r.slug}</div>
								</div>
								<StatusBadge
									className="shrink-0"
									bgColor={r.isActive ? "var(--accent-success)" : "var(--bg-tertiary)"}
									textColor={r.isActive ? "white" : "var(--text-muted)"}
									label={
										r.isActive
											? t(RestaurantsKeys.LIST_STATUS_ACTIVE)
											: t(RestaurantsKeys.LIST_STATUS_INACTIVE)
									}
								/>
								{!isTabletPortrait && (
									<span className="text-xs text-faint-foreground">{r.currency}</span>
								)}
							</div>
							<div className="flex items-center gap-2 flex-wrap">
								{canEditSettingsFor(r) && (
									<button
										type="button"
										onClick={() => setModal({ kind: "edit", restaurant: r })}
										className="p-1.5 rounded-md hover:bg-hover text-muted-foreground"
										title={t(RestaurantsKeys.LIST_EDIT)}
									>
										<Pencil size={16} />
									</button>
								)}
								{canManage && (
									<button
										type="button"
										onClick={() => setModal({ kind: "confirmDelete", restaurant: r })}
										className="p-1.5 rounded-md hover:bg-hover text-destructive"
										title={t(RestaurantsKeys.LIST_DELETE)}
									>
										<Trash2 size={16} />
									</button>
								)}
								{canManage && (
									<button
										onClick={() => setExpandedTablesId(r._id)}
										className="p-1.5 rounded-md hover:bg-hover text-muted-foreground"
										title={t(RestaurantsKeys.LIST_MANAGE_TABLES)}
									>
										<LayoutGrid size={16} />
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
												setError(getErrorMessage(err, t, RestaurantsKeys.LIST_TOGGLE_FAILED));
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
											<ToggleRight size={20} />
										) : (
											<ToggleLeft size={20} className="text-faint-foreground" />
										)}
									</button>
								)}
							</div>
						</div>
					);
				})}
				{restaurants.length === 0 && expandedTablesId === null && (
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
				<div className="p-6 rounded-xl bg-background border border-border">
					<div className="flex items-center justify-between mb-6">
						<h2 className="text-xl font-semibold text-foreground">
							{t(RestaurantsKeys.MODAL_CREATE_HEADING)}
						</h2>
						<button
							onClick={closeModal}
							className="p-1.5 rounded-md hover:bg-hover text-faint-foreground"
						>
							<X size={20} />
						</button>
					</div>
					<CreateRestaurantForm
						onCreated={(id) => {
							setSelectedRestaurantId(id);
							closeModal();
						}}
						onError={setError}
					/>
				</div>
			</Modal>

			{/* Edit Modal */}
			{modal.kind === "edit" && (
				<Modal isOpen onClose={closeModal} ariaLabel={t(RestaurantsKeys.MODAL_EDIT_ARIA)} size="lg">
					<div className="p-6 rounded-xl bg-background border border-border">
						<div className="flex items-center justify-between mb-6">
							<h2 className="text-xl font-semibold text-foreground">
								{t(RestaurantsKeys.MODAL_EDIT_HEADING)}
							</h2>
							<button
								onClick={closeModal}
								className="p-1.5 rounded-md hover:bg-hover text-faint-foreground"
							>
								<X size={20} />
							</button>
						</div>
						<RestaurantSettingsForm
							restaurant={modal.restaurant}
							organizations={organizations}
							settingsAccess={canManage ? "full" : "manager"}
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
									setError(getErrorMessage(err, t, RestaurantsKeys.FORM_UPDATE_FAILED));
								}
							}}
							onToggleActive={
								canManage
									? async (restaurantId) => {
											try {
												unwrapResult(await toggleActiveMutation.mutateAsync({ restaurantId }));
											} catch (err) {
												setError(getErrorMessage(err, t, RestaurantsKeys.LIST_TOGGLE_FAILED));
											}
										}
									: undefined
							}
							isSaving={updateMutation.isPending}
						/>
						{canManage ? (
							<>
								<div className="mt-6 border-t border-border pt-6">
									<RestaurantManagersField
										restaurantId={modal.restaurant._id}
										onError={(msg) => setError(msg)}
									/>
								</div>
								<div className="mt-6">
									<StripeConnectSetup restaurantId={modal.restaurant._id} />
								</div>
							</>
						) : null}
					</div>
				</Modal>
			)}

			{modal.kind === "confirmDelete" && (
				<Modal
					isOpen
					onClose={closeModal}
					ariaLabel={t(RestaurantsKeys.MODAL_DELETE_ARIA)}
					size="md"
				>
					<div className="p-6 rounded-xl bg-background border border-border">
						<div className="flex items-center justify-between mb-4">
							<h2 className="text-lg font-semibold text-foreground">
								{t(RestaurantsKeys.MODAL_DELETE_HEADING)}
							</h2>
							<button
								type="button"
								onClick={closeModal}
								className="p-1.5 rounded-md hover:bg-hover text-faint-foreground"
							>
								<X size={20} />
							</button>
						</div>
						<p className="text-sm text-muted-foreground mb-2">{modal.restaurant.name}</p>
						<p className="text-sm text-foreground mb-6">{t(RestaurantsKeys.MODAL_DELETE_BODY)}</p>
						<div className="flex justify-end gap-2">
							<button
								type="button"
								onClick={closeModal}
								className="px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-hover"
							>
								{t(RestaurantsKeys.MODAL_DELETE_CANCEL)}
							</button>
							<button
								type="button"
								onClick={async () => {
									try {
										unwrapResult(
											await softDeleteMutation.mutateAsync({
												restaurantId: modal.restaurant._id,
											})
										);
										closeModal();
									} catch (err) {
										setError(getErrorMessage(err, t, RestaurantsKeys.LIST_DELETE_FAILED));
									}
								}}
								disabled={softDeleteMutation.isPending}
								className="px-4 py-2 rounded-lg text-sm font-medium bg-destructive text-destructive-foreground hover:opacity-90"
							>
								{t(RestaurantsKeys.MODAL_DELETE_CONFIRM)}
							</button>
						</div>
					</div>
				</Modal>
			)}
		</div>
	);
}

interface ExpandedTablesRowProps {
	restaurant: Doc<"restaurants">;
	onClose: () => void;
}

function ExpandedTablesRow({ restaurant, onClose }: Readonly<ExpandedTablesRowProps>) {
	const { t } = useTranslation();
	const isTabletPortrait = useIsTabletPortraitViewport();
	return (
		<div className="rounded-xl bg-background border border-border min-h-[calc(100vh-12rem)] flex flex-col">
			<div className="sticky top-0 z-20 flex items-center justify-between gap-3 px-6 py-4 bg-background border-b border-border rounded-t-xl">
				<button
					type="button"
					onClick={onClose}
					className="flex items-center gap-1 px-2 py-1.5 rounded-md hover:bg-hover text-sm text-muted-foreground"
					title={t(RestaurantsKeys.TABLES_EXPANDED_CLOSE)}
					aria-label={t(RestaurantsKeys.TABLES_EXPANDED_CLOSE)}
				>
					<ChevronLeft size={16} />
				</button>
				<div className="flex items-center gap-3 min-w-0 flex-1">
					<h2 className="text-xl font-semibold text-foreground truncate">{restaurant.name}</h2>
					<StatusBadge
						bgColor={restaurant.isActive ? "var(--accent-success)" : "var(--bg-tertiary)"}
						textColor={restaurant.isActive ? "white" : "var(--text-muted)"}
						label={
							restaurant.isActive
								? t(RestaurantsKeys.LIST_STATUS_ACTIVE)
								: t(RestaurantsKeys.LIST_STATUS_INACTIVE)
						}
					/>
					{!isTabletPortrait && (
						<span className="text-xs text-faint-foreground">{restaurant.currency}</span>
					)}
				</div>
				<button
					type="button"
					onClick={onClose}
					className="p-1.5 rounded-md hover:bg-hover text-faint-foreground"
					title={t(RestaurantsKeys.TABLES_EXPANDED_CLOSE)}
					aria-label={t(RestaurantsKeys.TABLES_EXPANDED_CLOSE)}
				>
					<X size={20} />
				</button>
			</div>
			<div className="px-6 py-4 flex-1">
				<TablesManager restaurantId={restaurant._id} />
			</div>
		</div>
	);
}

function CreateRestaurantForm({
	onCreated,
	onError,
}: {
	onCreated: (id: Id<"restaurants">) => void;
	onError: (msg: string) => void;
}) {
	const { t } = useTranslation();
	const createMutation = useMutation({
		mutationFn: useConvexMutation(api.restaurants.create),
	});
	const organizations = useOrganizations();

	const form = useForm({
		defaultValues: { name: "", slug: "", currency: "MXN", organizationId: "" },
		onSubmit: async ({ value }) => {
			try {
				const id = unwrapResult(
					await createMutation.mutateAsync({
						name: value.name,
						slug: value.slug,
						currency: value.currency,
						timezone: DEFAULT_RESTAURANT_TIMEZONE,
						organizationId: value.organizationId as Id<"organizations">,
					})
				);
				onCreated(id!);
			} catch (err) {
				onError(getErrorMessage(err, t, RestaurantsKeys.FORM_CREATE_FAILED));
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
