import { ShiftDrawer, useAssignableMembers, type ShiftDrawerInitial } from "@/features/schedule";
import { RestaurantInviteMultiSelect } from "@/features/team/components/RestaurantInviteMultiSelect";
import {
	TeamMemberDrawer,
	type TeamMemberDrawerRow,
} from "@/features/team/components/TeamMemberDrawer";
import {
	createTeamDirectoryColumns,
	type TeamDirectoryRow,
} from "@/features/team/teamDirectoryColumns";
import { useRestaurant } from "@/features/restaurants";
import { useCurrentUserRoles } from "@/features/users/hooks";
import {
	AdminPageLayout,
	AdminTable,
	DialogHeader,
	Drawer,
	LoadingState,
} from "@/global/components";
import { useAdminTable, useIsNarrowViewport } from "@/global/hooks";
import { AdminStaffKeys, SidebarKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE, USER_ROLES } from "convex/constants";
import { useConvexAuth } from "convex/react";
import { useAuth } from "@clerk/tanstack-react-start";
import { Search, Users, UserPlus } from "lucide-react";
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
	const isNarrow = useIsNarrowViewport();
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

	const createInvitation = useMutation({
		mutationFn: useConvexMutation(api.invites.createInvitation),
	});
	const revokeInvitation = useMutation({
		mutationFn: useConvexMutation(api.invites.revokeInvitation),
	});
	const createEmployeeAccount = useMutation({
		mutationFn: useConvexMutation(api.employeeAccounts.createEmployeeAccount),
	});

	const [email, setEmail] = useState("");
	const [role, setRole] = useState<InviteRole>(RESTAURANT_MEMBER_ROLE.EMPLOYEE);
	const [selectedRestaurantIds, setSelectedRestaurantIds] = useState<Id<"restaurants">[]>([]);
	const [inviteModalOpen, setInviteModalOpen] = useState(false);
	const [revokePendingId, setRevokePendingId] = useState<Id<"invitations"> | null>(null);
	const [showRemoved, setShowRemoved] = useState(false);

	// Add employee modal state
	const [addEmployeeOpen, setAddEmployeeOpen] = useState(false);
	const [empFirstName, setEmpFirstName] = useState("");
	const [empPaternalLastname, setEmpPaternalLastname] = useState("");
	const [empMaternalLastname, setEmpMaternalLastname] = useState("");
	const [generatedPin, setGeneratedPin] = useState<string | null>(null);
	const [pinCopied, setPinCopied] = useState(false);

	const { members: assignableMembers } = useAssignableMembers(restaurant?._id);
	const assignableMemberIdSet = useMemo(
		() => new Set(assignableMembers.map((m) => String(m.memberId))),
		[assignableMembers]
	);
	const [shiftDrawerOpen, setShiftDrawerOpen] = useState(false);
	const [shiftDrawerInitial, setShiftDrawerInitial] = useState<ShiftDrawerInitial | null>(null);
	const [memberDrawerRow, setMemberDrawerRow] = useState<TeamMemberDrawerRow | null>(null);

	const handleOpenAssignShift = useCallback((memberId: Id<"restaurantMembers">) => {
		setShiftDrawerInitial({ mode: "create", memberId });
		setShiftDrawerOpen(true);
	}, []);

	const handleRowClick = useCallback((row: TeamDirectoryRow) => {
		if (row.rowType === "invite") return;
		setMemberDrawerRow(row);
	}, []);

	const handleCloseMemberDrawer = useCallback(() => {
		setMemberDrawerRow(null);
	}, []);

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
			organizationId != null ? restaurants.filter((r) => r.organizationId === organizationId) : [],
		[restaurants, organizationId]
	);

	const orgIdMatchesProfile =
		userOrgId != null && organizationId != null && userOrgId === String(organizationId);

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

	const canAddEmployee = isAdmin || isOrgOwner || isOrgManager || isRestaurantManagerOnly;

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
				onAssignShift: handleOpenAssignShift,
				assignableMemberIds: assignableMemberIdSet,
			}),
		[
			t,
			staffRoleLabelCb,
			handleRevokeInvite,
			revokePendingId,
			handleOpenAssignShift,
			assignableMemberIdSet,
		]
	);

	const tableState = useAdminTable<TeamDirectoryRow>({
		queryOptions: convexQuery(
			api.restaurantMembers.listTeamDirectory,
			restaurant?._id ? { restaurantId: restaurant._id, includeRemoved: showRemoved } : "skip"
		),
		columns,
		enabled: Boolean(isAuthenticated && restaurant?._id),
		getRowId: (row) => {
			if (row.rowType === "invite") return `invite:${row._id}`;
			if (row.rowType === "member") return `member:${row._id}`;
			return `${row.rowType}:${row.userId}`;
		},
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

	const onCreateEmployee = async () => {
		if (!restaurant?._id) return;
		const result = unwrapResult<{ employeeAccountId: string; memberId: string; pin: string }>(
			await createEmployeeAccount.mutateAsync({
				restaurantId: restaurant._id,
				firstName: empFirstName.trim(),
				paternalLastname: empPaternalLastname.trim(),
				maternalLastname: empMaternalLastname.trim(),
			})
		);
		setGeneratedPin(result.pin);
	};

	const closeAddEmployee = () => {
		setAddEmployeeOpen(false);
		setEmpFirstName("");
		setEmpPaternalLastname("");
		setEmpMaternalLastname("");
		setGeneratedPin(null);
		setPinCopied(false);
	};

	const copyPin = async () => {
		if (!generatedPin) return;
		await navigator.clipboard.writeText(generatedPin);
		setPinCopied(true);
		setTimeout(() => setPinCopied(false), 2000);
	};

	const headerActions = (
		<div className="flex items-center gap-2">
			{canAddEmployee && (
				<button
					type="button"
					onClick={() => setAddEmployeeOpen(true)}
					className="text-sm font-medium px-3 py-1.5 rounded-md bg-muted text-foreground hover:bg-muted/80 flex items-center gap-1.5"
				>
					<UserPlus className="w-3.5 h-3.5" />
					{t(AdminStaffKeys.TEAM_ADD_EMPLOYEE)}
				</button>
			)}
			{allowedInviteRoles.length > 0 && (
				<button
					type="button"
					onClick={() => setInviteModalOpen(true)}
					className="text-sm font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90"
				>
					{t(AdminStaffKeys.TEAM_SEND_INVITATION)}
				</button>
			)}
		</div>
	);

	if (isLoading || rolesLoading) return <LoadingState />;

	if (!restaurant || !organizationId) {
		return (
			<AdminPageLayout
				title={t(SidebarKeys.TEAM)}
				description={t(AdminStaffKeys.TEAM_DESCRIPTION_NO_RESTAURANT)}
			>
				<p className="text-sm text-faint-foreground">
					{t(AdminStaffKeys.TEAM_SETUP_RESTAURANT_FIRST)}
				</p>
			</AdminPageLayout>
		);
	}

	return (
		<AdminPageLayout
			title={t(SidebarKeys.TEAM)}
			description={t(AdminStaffKeys.TEAM_DESCRIPTION)}
			actions={headerActions}
		>
			<section className="flex flex-col h-full min-h-0 gap-6">
				<div className="flex items-center gap-3">
					<label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
						<input
							type="checkbox"
							checked={showRemoved}
							onChange={(e) => setShowRemoved(e.target.checked)}
							className="rounded border-border"
						/>
						{t(AdminStaffKeys.TEAM_SHOW_REMOVED)}
					</label>
				</div>

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
					onRowClick={handleRowClick}
				/>

				<TeamMemberDrawer
					isOpen={memberDrawerRow !== null}
					row={memberDrawerRow}
					restaurantId={restaurant?._id ?? null}
					restaurantTimezone={restaurant?.timezone ?? "UTC"}
					restaurantCurrency={restaurant?.currency ?? ""}
					staffRoleLabel={staffRoleLabelCb}
					onClose={handleCloseMemberDrawer}
				/>

				{/* Invite drawer */}
				<Drawer
					isOpen={inviteModalOpen}
					onClose={closeInviteModal}
					ariaLabel={t(AdminStaffKeys.TEAM_INVITE_MODAL_TITLE)}
					side={isNarrow ? "bottom" : "right"}
					size={isNarrow ? "92dvh" : "min(520px, 90vw)"}
					swipeToClose={isNarrow}
					swipeHandleAriaLabel={t(AdminStaffKeys.SCHEDULE_DRAWER_SWIPE_HANDLE)}
					panelClassName="bg-background border border-border overflow-hidden"
				>
					<DialogHeader
						title={t(AdminStaffKeys.TEAM_INVITE_MODAL_TITLE)}
						onClose={closeInviteModal}
					/>
					<div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-3">
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
								<p className="mt-1 text-sm text-faint-foreground">
									{t(AdminStaffKeys.TEAM_INVITE_NO_ROLE)}
								</p>
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
								<span className="font-medium text-foreground">
									{t(AdminStaffKeys.TEAM_RESTAURANTS_LABEL)}
								</span>
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
					</div>
					<div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
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
							{createInvitation.isPending
								? t(AdminStaffKeys.TEAM_SENDING)
								: t(AdminStaffKeys.TEAM_SEND_INVITE)}
						</button>
					</div>
				</Drawer>

				{/* Add employee drawer */}
				<Drawer
					isOpen={addEmployeeOpen}
					onClose={closeAddEmployee}
					ariaLabel={t(AdminStaffKeys.TEAM_ADD_EMPLOYEE_MODAL_TITLE)}
					side={isNarrow ? "bottom" : "right"}
					size={isNarrow ? "92dvh" : "min(520px, 90vw)"}
					swipeToClose={isNarrow}
					swipeHandleAriaLabel={t(AdminStaffKeys.SCHEDULE_DRAWER_SWIPE_HANDLE)}
					panelClassName="bg-background border border-border overflow-hidden"
				>
					<DialogHeader
						title={t(AdminStaffKeys.TEAM_ADD_EMPLOYEE_MODAL_TITLE)}
						onClose={closeAddEmployee}
					/>
					<div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-3">
						{generatedPin ? (
							<div className="space-y-4">
								<h3 className="text-sm font-semibold text-foreground">
									{t(AdminStaffKeys.TEAM_EMPLOYEE_PIN_TITLE)}
								</h3>
								<div className="flex items-center justify-center">
									<span className="text-3xl font-mono font-bold tracking-[0.3em] text-foreground bg-muted px-6 py-3 rounded-lg">
										{generatedPin}
									</span>
								</div>
								<p className="text-xs text-destructive text-center font-medium">
									{t(AdminStaffKeys.TEAM_EMPLOYEE_PIN_WARNING)}
								</p>
								<div className="flex items-center justify-center gap-3">
									<button
										type="button"
										onClick={() => void copyPin()}
										className="text-sm font-medium px-4 py-1.5 rounded-md bg-muted text-foreground hover:bg-muted/80"
									>
										{pinCopied
											? t(AdminStaffKeys.TEAM_EMPLOYEE_PIN_COPIED)
											: t(AdminStaffKeys.TEAM_EMPLOYEE_PIN_COPY)}
									</button>
									<button
										type="button"
										onClick={closeAddEmployee}
										className="text-sm font-medium px-4 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90"
									>
										{t(AdminStaffKeys.TEAM_EMPLOYEE_PIN_DONE)}
									</button>
								</div>
							</div>
						) : (
							<>
								<label className="block text-xs text-faint-foreground">
									{t(AdminStaffKeys.TEAM_EMPLOYEE_FIRST_NAME)}
									<input
										className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
										value={empFirstName}
										onChange={(e) => setEmpFirstName(e.target.value)}
										autoFocus
									/>
								</label>
								<label className="block text-xs text-faint-foreground">
									{t(AdminStaffKeys.TEAM_EMPLOYEE_PATERNAL_LASTNAME)}
									<input
										className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
										value={empPaternalLastname}
										onChange={(e) => setEmpPaternalLastname(e.target.value)}
									/>
								</label>
								<label className="block text-xs text-faint-foreground">
									{t(AdminStaffKeys.TEAM_EMPLOYEE_MATERNAL_LASTNAME)}
									<input
										className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
										value={empMaternalLastname}
										onChange={(e) => setEmpMaternalLastname(e.target.value)}
									/>
								</label>
							</>
						)}
					</div>
					{!generatedPin && (
						<div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
							<button
								type="button"
								onClick={() => void onCreateEmployee()}
								disabled={
									createEmployeeAccount.isPending ||
									!empFirstName.trim() ||
									!empPaternalLastname.trim() ||
									!empMaternalLastname.trim()
								}
								className="text-sm font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
							>
								{createEmployeeAccount.isPending
									? t(AdminStaffKeys.TEAM_EMPLOYEE_CREATING)
									: t(AdminStaffKeys.TEAM_EMPLOYEE_CREATE)}
							</button>
						</div>
					)}
				</Drawer>

				{shiftDrawerInitial && restaurant ? (
					<ShiftDrawer
						isOpen={shiftDrawerOpen}
						onClose={() => setShiftDrawerOpen(false)}
						restaurantId={restaurant._id}
						restaurantTimezone={restaurant.timezone ?? "UTC"}
						members={assignableMembers}
						initial={shiftDrawerInitial}
						hideRecurringTab
					/>
				) : null}
			</section>
		</AdminPageLayout>
	);
}
