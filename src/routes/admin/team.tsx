import { RestaurantInviteMultiSelect } from "@/features/team/components/RestaurantInviteMultiSelect";
import { createTeamDirectoryColumns, type TeamDirectoryRow } from "@/features/team/teamDirectoryColumns";
import { useRestaurant } from "@/features/restaurants";
import { useCurrentUserRoles } from "@/features/users/hooks";
import { AdminPageLayout, AdminTable, DialogHeader, LoadingState, Modal } from "@/global/components";
import { useAdminTable } from "@/global/hooks";
import { AdminStaffKeys, SidebarKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { Row } from "@tanstack/react-table";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE, USER_ROLES } from "convex/constants";
import { useConvexAuth } from "convex/react";
import { useAuth } from "@clerk/tanstack-react-start";
import { Search, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/team")({
	component: AdminTeamPage,
});

type InviteRole =
	| typeof USER_ROLES.OWNER
	| typeof RESTAURANT_MEMBER_ROLE.MANAGER
	| typeof RESTAURANT_MEMBER_ROLE.EMPLOYEE;

const INVITE_ROLE_ORDER: InviteRole[] = [
	USER_ROLES.OWNER,
	RESTAURANT_MEMBER_ROLE.MANAGER,
	RESTAURANT_MEMBER_ROLE.EMPLOYEE,
];

function staffRoleLabel(role: string, t: (key: string) => string): string {
	if (role === USER_ROLES.OWNER) return t(AdminStaffKeys.TEAM_ROLE_DISPLAY_OWNER);
	if (role === USER_ROLES.MANAGER || role === RESTAURANT_MEMBER_ROLE.MANAGER) {
		return t(AdminStaffKeys.TEAM_ROLE_DISPLAY_MANAGER);
	}
	if (role === USER_ROLES.EMPLOYEE || role === RESTAURANT_MEMBER_ROLE.EMPLOYEE) {
		return t(AdminStaffKeys.TEAM_ROLE_DISPLAY_EMPLOYEE);
	}
	return role;
}

function inviteAssignableRoleLabel(role: InviteRole, t: (key: string) => string): string {
	if (role === USER_ROLES.OWNER) return t(AdminStaffKeys.TEAM_ROLE_OWNER_OPTION);
	if (role === RESTAURANT_MEMBER_ROLE.MANAGER) return t(AdminStaffKeys.TEAM_ROLE_MANAGER_OPTION);
	return t(AdminStaffKeys.TEAM_ROLE_EMPLOYEE_OPTION);
}

function AdminTeamPage() {
	const { t } = useTranslation();
	const { isAuthenticated } = useConvexAuth();
	const { userId } = useAuth();
	const { roles, organizationId: userOrgId, isLoading: rolesLoading } = useCurrentUserRoles();
	const { restaurant, restaurants, isLoading } = useRestaurant();
	const organizationId = restaurant?.organizationId;

	const { data: myMemberships } = useQuery({
		...convexQuery(api.restaurantMembers.listByUser, {}),
		enabled: isAuthenticated,
		select: unwrapResult<Doc<"restaurantMembers">[]>,
	});

	const createInvitation = useMutation({ mutationFn: useConvexMutation(api.invites.createInvitation) });
	const revokeInvitation = useMutation({ mutationFn: useConvexMutation(api.invites.revokeInvitation) });

	const [email, setEmail] = useState("");
	const [role, setRole] = useState<InviteRole>(RESTAURANT_MEMBER_ROLE.EMPLOYEE);
	const [selectedRestaurantIds, setSelectedRestaurantIds] = useState<Id<"restaurants">[]>([]);
	const [inviteModalOpen, setInviteModalOpen] = useState(false);
	const [revokePendingId, setRevokePendingId] = useState<Id<"invitations"> | null>(null);

	const isAdmin = roles.includes(USER_ROLES.ADMIN);

	const managedRestaurantIds = useMemo(() => {
		if (!myMemberships?.length || !organizationId) return [];
		return myMemberships
			.filter(
				(m) =>
					m.isActive &&
					m.role === RESTAURANT_MEMBER_ROLE.MANAGER &&
					m.organizationId === organizationId
			)
			.map((m) => m.restaurantId);
	}, [myMemberships, organizationId]);

	const orgRestaurants = useMemo(
		() =>
			organizationId != null
				? restaurants.filter((r) => r.organizationId === organizationId)
				: [],
		[restaurants, organizationId]
	);

	const orgIdMatchesProfile =
		userOrgId != null &&
		organizationId != null &&
		userOrgId === String(organizationId);

	const ownsRestaurantInCurrentOrg = useMemo(() => {
		if (!userId || !organizationId) return false;
		return orgRestaurants.some((r) => r.ownerId === userId);
	}, [userId, organizationId, orgRestaurants]);

	const isRestaurantManagerInCurrentOrg = useMemo(() => {
		if (!organizationId || !myMemberships?.length) return false;
		return myMemberships.some(
			(m) =>
				m.isActive &&
				m.organizationId === organizationId &&
				m.role === RESTAURANT_MEMBER_ROLE.MANAGER
		);
	}, [myMemberships, organizationId]);

	const isOrgOwner =
		roles.includes(USER_ROLES.OWNER) &&
		organizationId != null &&
		(orgIdMatchesProfile || ownsRestaurantInCurrentOrg);

	const isOrgManager =
		roles.includes(USER_ROLES.MANAGER) &&
		organizationId != null &&
		(orgIdMatchesProfile || isRestaurantManagerInCurrentOrg);

	const isRestaurantManagerOnly =
		!isAdmin && !isOrgOwner && !isOrgManager && managedRestaurantIds.length > 0;

	const allowedInviteRoles = useMemo(() => {
		if (isAdmin) return [...INVITE_ROLE_ORDER];
		if (isOrgOwner) return [RESTAURANT_MEMBER_ROLE.MANAGER, RESTAURANT_MEMBER_ROLE.EMPLOYEE];
		if (isOrgManager || isRestaurantManagerOnly) return [RESTAURANT_MEMBER_ROLE.EMPLOYEE];
		return [];
	}, [isAdmin, isOrgOwner, isOrgManager, isRestaurantManagerOnly]);

	useEffect(() => {
		if (allowedInviteRoles.length === 0) return;
		if (!allowedInviteRoles.includes(role)) {
			setRole(allowedInviteRoles[0]);
		}
	}, [allowedInviteRoles, role]);

	const restaurantPickerOptions = useMemo(() => {
		if (isAdmin || isOrgOwner || isOrgManager) return orgRestaurants;
		if (managedRestaurantIds.length > 0) {
			const allow = new Set(managedRestaurantIds);
			return orgRestaurants.filter((r) => allow.has(r._id));
		}
		return orgRestaurants;
	}, [isAdmin, isOrgOwner, isOrgManager, orgRestaurants, managedRestaurantIds]);

	const restaurantInviteOptions = useMemo(
		() => restaurantPickerOptions.map((r) => ({ id: r._id, label: r.name })),
		[restaurantPickerOptions]
	);

	useEffect(() => {
		const allow = new Set(restaurantPickerOptions.map((r) => r._id));
		setSelectedRestaurantIds((prev) => prev.filter((id) => allow.has(id)));
	}, [restaurantPickerOptions]);

	const restaurantSummaryText = useMemo(() => {
		if (selectedRestaurantIds.length === 0) return "";
		const names = selectedRestaurantIds
			.map((id) => restaurantInviteOptions.find((o) => o.id === id)?.label)
			.filter((x): x is string => Boolean(x));
		if (names.length === 0) return "";
		if (names.length === 1) return names[0];
		if (names.length === 2) return `${names[0]}, ${names[1]}`;
		return t(AdminStaffKeys.TEAM_RESTAURANTS_SUMMARY_MANY, {
			first: names[0],
			second: names[1],
			rest: names.length - 2,
		});
	}, [selectedRestaurantIds, restaurantInviteOptions, t]);

	const staffRoleLabelCb = useCallback((r: string) => staffRoleLabel(r, t), [t]);

	const handleRevokeInvite = useCallback(
		async (invitationId: Id<"invitations">) => {
			setRevokePendingId(invitationId);
			try {
				unwrapResult(await revokeInvitation.mutateAsync({ invitationId }));
			} catch {
				/* toast elsewhere */
			} finally {
				setRevokePendingId(null);
			}
		},
		[revokeInvitation]
	);

	const columns = useMemo(
		() =>
			createTeamDirectoryColumns({
				t,
				staffRoleLabel: staffRoleLabelCb,
				onRevokeInvite: (id) => {
					void handleRevokeInvite(id);
				},
				revokePendingId,
			}),
		[t, staffRoleLabelCb, handleRevokeInvite, revokePendingId]
	);

	const globalFilterFn = useMemo(
		() => (row: Row<TeamDirectoryRow>, _columnId: string, filterValue: unknown) => {
			if (!filterValue) return true;
			const q = String(filterValue).toLowerCase();
			const data = row.original;
			const identity =
				data.rowType === "invite"
					? data.email
					: (data.email?.trim() ? data.email : data.userId);
			const roleLabel = staffRoleLabelCb(data.role).toLowerCase();
			const statusLabel =
				data.rowType === "invite"
					? t(AdminStaffKeys.TEAM_STATUS_PENDING_INVITE).toLowerCase()
					: data.isActive
						? t(AdminStaffKeys.TEAM_STATUS_ACTIVE).toLowerCase()
						: t(AdminStaffKeys.TEAM_MEMBER_INACTIVE).toLowerCase();
			return (
				identity.toLowerCase().includes(q) ||
				data.role.toLowerCase().includes(q) ||
				roleLabel.includes(q) ||
				statusLabel.includes(q)
			);
		},
		[t, staffRoleLabelCb]
	);

	const tableState = useAdminTable<TeamDirectoryRow>({
		queryOptions: convexQuery(
			api.restaurantMembers.listTeamDirectory,
			restaurant?._id ? { restaurantId: restaurant._id } : "skip"
		),
		columns,
		enabled: Boolean(isAuthenticated && restaurant?._id),
		getRowId: (row) => {
			if (row.rowType === "invite") return `invite:${row._id}`;
			if (row.rowType === "member") return `member:${row._id}`;
			return `${row.rowType}:${row.userId}`;
		},
		globalFilterFn,
	});

	const onInvite = async () => {
		if (!organizationId || !email.trim()) return;
		if (allowedInviteRoles.length > 0 && !allowedInviteRoles.includes(role)) return;
		const restaurantIds =
			role === USER_ROLES.OWNER ? [] : selectedRestaurantIds.length ? selectedRestaurantIds : [];
		unwrapResult(
			await createInvitation.mutateAsync({
				organizationId,
				email: email.trim(),
				role,
				restaurantIds,
			})
		);
		setEmail("");
		setSelectedRestaurantIds([]);
		setInviteModalOpen(false);
	};

	const closeInviteModal = () => {
		setInviteModalOpen(false);
	};

	const headerActions =
		allowedInviteRoles.length > 0 ? (
			<button
				type="button"
				onClick={() => setInviteModalOpen(true)}
				className="text-sm font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90"
			>
				{t(AdminStaffKeys.TEAM_SEND_INVITATION)}
			</button>
		) : null;

	if (isLoading || rolesLoading) return <LoadingState />;

	if (!restaurant || !organizationId) {
		return (
			<AdminPageLayout
				title={t(SidebarKeys.TEAM)}
				description={t(AdminStaffKeys.TEAM_DESCRIPTION_NO_RESTAURANT)}
			>
				<p className="text-sm text-faint-foreground">{t(AdminStaffKeys.TEAM_SETUP_RESTAURANT_FIRST)}</p>
			</AdminPageLayout>
		);
	}

	return (
		<AdminPageLayout
			title={t(SidebarKeys.TEAM)}
			description={t(AdminStaffKeys.TEAM_DESCRIPTION)}
			actions={headerActions}
		>
			<section className="flex flex-col flex-1 min-h-0 gap-6 max-w-5xl">
				<AdminTable
					tableState={tableState}
					entityName={t(AdminStaffKeys.TEAM_DIRECTORY_ENTITY_NAME)}
					searchPlaceholder={t(AdminStaffKeys.TEAM_DIRECTORY_SEARCH_PLACEHOLDER)}
					emptyIcon={Users}
					emptyTitle={t(AdminStaffKeys.TEAM_DIRECTORY_EMPTY_TITLE)}
					emptyDescription={t(AdminStaffKeys.TEAM_DIRECTORY_EMPTY_DESCRIPTION)}
					filteredEmptyIcon={Search}
					filteredEmptyTitle={t(AdminStaffKeys.TEAM_DIRECTORY_FILTERED_EMPTY_TITLE)}
					filteredEmptyDescription={t(AdminStaffKeys.TEAM_DIRECTORY_FILTERED_EMPTY_DESCRIPTION)}
					notAuthenticatedMessage={t(AdminStaffKeys.TEAM_DESCRIPTION)}
				/>

				<Modal
					isOpen={inviteModalOpen}
					onClose={closeInviteModal}
					ariaLabel={t(AdminStaffKeys.TEAM_INVITE_MODAL_TITLE)}
					size="lg"
				>
					<div className="rounded-lg border border-border bg-card overflow-hidden">
						<DialogHeader title={t(AdminStaffKeys.TEAM_INVITE_MODAL_TITLE)} onClose={closeInviteModal} />
						<div className="p-4 space-y-3">
							<label className="block text-xs text-faint-foreground">
								{t(AdminStaffKeys.TEAM_EMAIL_LABEL)}
								<input
									className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									type="email"
									autoComplete="email"
								/>
							</label>
							<div className="block text-xs text-faint-foreground">
								<span>{t(AdminStaffKeys.TEAM_ROLE_LABEL)}</span>
								{allowedInviteRoles.length === 0 ? (
									<p className="mt-1 text-sm text-faint-foreground">{t(AdminStaffKeys.TEAM_INVITE_NO_ROLE)}</p>
								) : allowedInviteRoles.length === 1 ? (
									<>
										<p className="mt-1 text-sm text-foreground">
											{inviteAssignableRoleLabel(allowedInviteRoles[0], t)}
										</p>
										<p className="mt-1 text-xs text-muted-foreground">
											{t(AdminStaffKeys.TEAM_INVITE_SINGLE_ROLE_HINT)}
										</p>
									</>
								) : (
									<select
										className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
										value={role}
										onChange={(e) => setRole(e.target.value as InviteRole)}
									>
										{allowedInviteRoles.map((r) => (
											<option key={r} value={r}>
												{inviteAssignableRoleLabel(r, t)}
											</option>
										))}
									</select>
								)}
							</div>
							{role !== USER_ROLES.OWNER && (
								<div className="text-xs text-faint-foreground space-y-1">
									<span className="font-medium text-foreground">{t(AdminStaffKeys.TEAM_RESTAURANTS_LABEL)}</span>
									<RestaurantInviteMultiSelect
										options={restaurantInviteOptions}
										selectedIds={selectedRestaurantIds}
										onChange={setSelectedRestaurantIds}
										placeholder={t(AdminStaffKeys.TEAM_RESTAURANTS_PLACEHOLDER)}
										summaryText={restaurantSummaryText}
										ariaLabel={t(AdminStaffKeys.TEAM_RESTAURANTS_ARIA)}
										disabled={createInvitation.isPending}
									/>
								</div>
							)}
							<button
								type="button"
								onClick={() => void onInvite()}
								disabled={
									createInvitation.isPending ||
									!email.trim() ||
									allowedInviteRoles.length === 0 ||
									(role !== USER_ROLES.OWNER &&
										(selectedRestaurantIds.length === 0 || restaurantInviteOptions.length === 0))
								}
								className="text-sm font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
							>
								{createInvitation.isPending ? t(AdminStaffKeys.TEAM_SENDING) : t(AdminStaffKeys.TEAM_SEND_INVITE)}
							</button>
						</div>
					</div>
				</Modal>
			</section>
		</AdminPageLayout>
	);
}
