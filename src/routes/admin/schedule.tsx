import { MemberAttendanceDrawer } from "@/features/attendance";
import { useRestaurant } from "@/features/restaurants";
import {
	PublishWeekButton,
	ScheduleWeekGrid,
	ShiftCellChip,
	ShiftDrawer,
	getMondayYmdOfWeek,
	startOfDayMs,
	endOfWeekMs,
	useAssignableMembers,
	type AbsenceDateMap,
	type AssignableMember,
	type ScheduledShiftView,
	type ShiftDrawerInitial,
} from "@/features/schedule";
import { ClearSchedulesModal } from "@/features/schedule/components/ClearSchedulesModal";
import { SegmentedControl } from "@/global/components/SegmentedControl/SegmentedControl";
import { useCurrentUserRoles } from "@/features/users/hooks";
import { AdminPageLayout, EmptyState, LoadingState } from "@/global/components";
import { AdminStaffKeys, SidebarKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { useAuth, useUser } from "@clerk/tanstack-react-start";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import {
	ABSENCE_REQUEST_STATUS,
	RESTAURANT_MEMBER_ROLE,
	SHIFT_STATUS,
	USER_ROLES,
} from "convex/constants";
import { useConvexAuth } from "convex/react";
import { CalendarRange, Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/schedule")({
	component: AdminSchedulePage,
});

const DEFAULT_TIMEZONE = "UTC";

function AdminSchedulePage() {
	const { t, i18n } = useTranslation();
	const { restaurant, isLoading } = useRestaurant();
	const queryClient = useQueryClient();
	const { isAuthenticated } = useConvexAuth();
	const { userId } = useAuth();
	const { user } = useUser();
	const { roles: userRoles, organizationId: currentUserOrgId } =
		useCurrentUserRoles();

	const timezone = restaurant?.timezone ?? DEFAULT_TIMEZONE;
	const [anchorMs, setAnchorMs] = useState(() => Date.now());

	const mondayYmd = useMemo(
		() => getMondayYmdOfWeek(anchorMs, timezone),
		[anchorMs, timezone]
	);
	const weekStartMs = useMemo(
		() => startOfDayMs(mondayYmd, timezone),
		[mondayYmd, timezone]
	);
	const weekEndMs = useMemo(
		() => endOfWeekMs(mondayYmd, timezone),
		[mondayYmd, timezone]
	);

	const { data: myMemberships } = useQuery({
		...convexQuery(api.restaurantMembers.listByUser, {}),
		enabled: isAuthenticated,
		select: unwrapResult<Doc<"restaurantMembers">[]>,
	});

	const myMembership = useMemo(() => {
		if (!restaurant?._id || !myMemberships) return null;
		return (
			myMemberships.find(
				(row) => row.restaurantId === restaurant._id && row.isActive
			) ?? null
		);
	}, [myMemberships, restaurant?._id]);

	const myMemberId = myMembership?._id ?? null;

	// Mirrors convex/_util/auth.ts → requireRestaurantManagerOrAbove so the
	// client decides which schedule view (full team grid vs single own-row) to
	// render before the backend would reject the manager-only query.
	const isManagerOrAbove = useMemo(() => {
		if (!restaurant || !userId) return false;
		if (userRoles.includes(USER_ROLES.ADMIN)) return true;
		if (restaurant.ownerId === userId) return true;
		if (
			userRoles.includes(USER_ROLES.OWNER) &&
			currentUserOrgId === restaurant.organizationId
		) {
			return true;
		}
		if (
			myMembership?.isActive &&
			myMembership.role === RESTAURANT_MEMBER_ROLE.MANAGER
		) {
			return true;
		}
		return false;
	}, [restaurant, userId, userRoles, currentUserOrgId, myMembership]);

	const formatRange = useMemo(() => {
		const fmt = new Intl.DateTimeFormat(i18n.language, {
			month: "short",
			day: "numeric",
		});
		return `${fmt.format(new Date(weekStartMs))} – ${fmt.format(new Date(weekEndMs - 1))}`;
	}, [i18n.language, weekStartMs, weekEndMs]);

	if (isLoading) return <LoadingState />;

	if (!restaurant) {
		return (
			<AdminPageLayout
				title={t(SidebarKeys.SCHEDULE)}
				description={t(AdminStaffKeys.SCHEDULE_DESCRIPTION_NO_RESTAURANT)}
			>
				<p className="text-sm text-faint-foreground">
					{t(AdminStaffKeys.SCHEDULE_NO_RESTAURANT)}
				</p>
			</AdminPageLayout>
		);
	}

	if (isManagerOrAbove) {
		return (
			<ManagerScheduleView
				restaurant={restaurant}
				timezone={timezone}
				mondayYmd={mondayYmd}
				weekStartMs={weekStartMs}
				weekEndMs={weekEndMs}
				formatRange={formatRange}
				queryClient={queryClient}
				setAnchorMs={setAnchorMs}
				myMemberId={myMemberId}
			/>
		);
	}

	return (
		<EmployeeScheduleView
			restaurant={restaurant}
			timezone={timezone}
			mondayYmd={mondayYmd}
			weekStartMs={weekStartMs}
			weekEndMs={weekEndMs}
			formatRange={formatRange}
			setAnchorMs={setAnchorMs}
			myMembership={myMembership}
			ownEmail={user?.primaryEmailAddress?.emailAddress ?? null}
		/>
	);
}

interface ManagerScheduleViewProps {
	readonly restaurant: Doc<"restaurants">;
	readonly timezone: string;
	readonly mondayYmd: string;
	readonly weekStartMs: number;
	readonly weekEndMs: number;
	readonly formatRange: string;
	readonly queryClient: ReturnType<typeof useQueryClient>;
	readonly setAnchorMs: (updater: (prev: number) => number) => void;
	readonly myMemberId: Id<"restaurantMembers"> | null;
}

interface AbsenceMapsResult {
	readonly pendingDatesByMember: AbsenceDateMap;
	readonly approvedDatesByMember: AbsenceDateMap;
	readonly pendingCountByMember: ReadonlyMap<Id<"restaurantMembers">, number>;
}

/**
 * Bucket absences into per-member date maps so the grid can do O(1) chip
 * coloring + O(1) row-asterisk lookups. Pending counts span all dates so a
 * stale request from any week still surfaces the asterisk on the row header
 * regardless of which week the manager is currently viewing.
 */
function buildAbsenceMaps(
	absences: ReadonlyArray<Doc<"absences">>
): AbsenceMapsResult {
	const pending = new Map<
		Id<"restaurantMembers">,
		Map<string, Doc<"absences">>
	>();
	const approved = new Map<
		Id<"restaurantMembers">,
		Map<string, Doc<"absences">>
	>();
	const pendingCount = new Map<Id<"restaurantMembers">, number>();
	for (const a of absences) {
		if (a.status === ABSENCE_REQUEST_STATUS.PENDING) {
			let perMember = pending.get(a.memberId);
			if (!perMember) {
				perMember = new Map();
				pending.set(a.memberId, perMember);
			}
			perMember.set(a.date, a);
			pendingCount.set(a.memberId, (pendingCount.get(a.memberId) ?? 0) + 1);
		} else if (a.status === ABSENCE_REQUEST_STATUS.APPROVED) {
			let perMember = approved.get(a.memberId);
			if (!perMember) {
				perMember = new Map();
				approved.set(a.memberId, perMember);
			}
			perMember.set(a.date, a);
		}
	}
	return {
		pendingDatesByMember: pending,
		approvedDatesByMember: approved,
		pendingCountByMember: pendingCount,
	};
}

/**
 * Match the same label expression rendered in the row header
 * (`email` if non-empty, otherwise `userId`) so what the manager sees in the
 * grid is exactly what the filter searches against.
 */
function filterMembersByLabel(
	members: readonly AssignableMember[],
	query: string
): readonly AssignableMember[] {
	const q = query.trim().toLowerCase();
	if (!q) return members;
	return members.filter((m) => {
		const label = (m.email?.trim() ? m.email : m.userId) ?? "";
		return label.toLowerCase().includes(q);
	});
}

function ManagerScheduleView({
	restaurant,
	timezone,
	mondayYmd,
	weekStartMs,
	weekEndMs,
	formatRange,
	queryClient,
	setAnchorMs,
	myMemberId,
}: Readonly<ManagerScheduleViewProps>) {
	const { t, i18n } = useTranslation();

	const { members } = useAssignableMembers(restaurant._id);

	const shiftsQueryArgs = { restaurantId: restaurant._id, weekStartMs };
	const shiftsQuery = useQuery({
		...convexQuery(api.shifts.listForRestaurantWeek, shiftsQueryArgs),
		select: unwrapResult<ScheduledShiftView[]>,
	});

	const absencesQuery = useQuery({
		...convexQuery(api.attendance.listAbsencesForRestaurant, {
			restaurantId: restaurant._id,
		}),
		select: unwrapResult<Doc<"absences">[]>,
	});

	const shifts = shiftsQuery.data ?? [];
	const absences = absencesQuery.data ?? [];

	const { pendingDatesByMember, approvedDatesByMember, pendingCountByMember } =
		useMemo(() => buildAbsenceMaps(absences), [absences]);

	const draftCount = useMemo(
		() => shifts.filter((s) => s.status === SHIFT_STATUS.SCHEDULED).length,
		[shifts]
	);

	const [drawerOpen, setDrawerOpen] = useState(false);
	const [drawerInitial, setDrawerInitial] = useState<ShiftDrawerInitial | null>(null);

	const [attendanceMemberId, setAttendanceMemberId] =
		useState<Id<"restaurantMembers"> | null>(null);

	const [clearModalOpen, setClearModalOpen] = useState(false);

	const [memberFilter, setMemberFilter] = useState("");
	const [shiftPresenceFilter, setShiftPresenceFilter] = useState<
		"all" | "withShifts" | "noShifts"
	>("all");

	const memberIdsWithShifts = useMemo(() => {
		const ids = new Set<string>();
		for (const s of shifts) ids.add(s.memberId);
		return ids;
	}, [shifts]);

	const shiftPresenceOptions = useMemo(
		() => [
			{ value: "all" as const, label: t(AdminStaffKeys.SCHEDULE_FILTER_SEGMENT_ALL) },
			{ value: "withShifts" as const, label: t(AdminStaffKeys.SCHEDULE_FILTER_SEGMENT_WITH_SHIFTS) },
			{ value: "noShifts" as const, label: t(AdminStaffKeys.SCHEDULE_FILTER_SEGMENT_NO_SHIFTS) },
		],
		[t]
	);

	const filteredMembers = useMemo(() => {
		let result = filterMembersByLabel(members, memberFilter);
		if (shiftPresenceFilter === "withShifts") {
			result = result.filter((m) => memberIdsWithShifts.has(m.memberId));
		} else if (shiftPresenceFilter === "noShifts") {
			result = result.filter((m) => !memberIdsWithShifts.has(m.memberId));
		}
		return result;
	}, [members, memberFilter, shiftPresenceFilter, memberIdsWithShifts]);

	const attendanceMember = useMemo<AssignableMember | null>(() => {
		if (!attendanceMemberId) return null;
		return members.find((m) => m.memberId === attendanceMemberId) ?? null;
	}, [members, attendanceMemberId]);

	const openCreate = (memberId?: Id<"restaurantMembers">, ymd?: string) => {
		setDrawerInitial({ mode: "create", memberId, ymd });
		setDrawerOpen(true);
	};

	const openEdit = (shift: ScheduledShiftView) => {
		setDrawerInitial({ mode: "edit", shift });
		setDrawerOpen(true);
	};

	const refetch = () => {
		queryClient.invalidateQueries({
			queryKey: convexQuery(api.shifts.listForRestaurantWeek, shiftsQueryArgs)
				.queryKey,
		});
	};

	if (members.length === 0) {
		return (
			<AdminPageLayout
				title={t(SidebarKeys.SCHEDULE)}
				description={t(AdminStaffKeys.SCHEDULE_DESCRIPTION)}
			>
				<div className="flex flex-col h-full">
					<EmptyState
						fill
						icon={Users}
						title={t(AdminStaffKeys.SCHEDULE_GRID_NO_MEMBERS)}
						description={t(AdminStaffKeys.SCHEDULE_GRID_NO_MEMBERS_DESCRIPTION)}
						action={
							<Link
								to="/admin/team"
								className="text-xs font-medium px-3 py-1.5 rounded-md border border-border bg-background hover:bg-(--bg-hover)"
							>
								{t(AdminStaffKeys.SCHEDULE_INVITE_TEAM_ACTION)}
							</Link>
						}
					/>
				</div>
			</AdminPageLayout>
		);
	}

	const headerActions = (
		<div className="flex items-center gap-2">
			<button
				type="button"
				onClick={() => openCreate()}
				disabled={members.length === 0}
				className="text-xs font-medium px-3 py-1.5 rounded-md border border-border bg-background hover:bg-(--bg-hover) disabled:opacity-50"
			>
				{t(AdminStaffKeys.SCHEDULE_ASSIGN_SHIFT)}
			</button>
			<button
				type="button"
				onClick={() => setClearModalOpen(true)}
				disabled={members.length === 0}
				className="text-xs font-medium px-3 py-1.5 rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-50"
			>
				{t(AdminStaffKeys.SCHEDULE_CLEAR_SCHEDULES)}
			</button>
			<PublishWeekButton
				restaurantId={restaurant._id}
				weekStartMs={weekStartMs}
				draftCount={draftCount}
				onPublished={refetch}
			/>
		</div>
	);

	return (
		<AdminPageLayout
			title={t(SidebarKeys.SCHEDULE)}
			description={t(AdminStaffKeys.SCHEDULE_DESCRIPTION)}
			actions={headerActions}
		>
			<div className="flex flex-wrap items-center justify-between gap-2 mb-4">
				<div className="flex items-center gap-2">
					<button
						type="button"
						className="text-xs px-2 py-1 rounded border border-border hover:bg-(--bg-hover)"
						onClick={() => setAnchorMs((a) => a - 7 * 24 * 60 * 60 * 1000)}
					>
						{t(AdminStaffKeys.SCHEDULE_PREV_WEEK)}
					</button>
					<span className="text-xs font-medium text-foreground">{formatRange}</span>
					<button
						type="button"
						className="text-xs px-2 py-1 rounded border border-border hover:bg-(--bg-hover)"
						onClick={() => setAnchorMs((a) => a + 7 * 24 * 60 * 60 * 1000)}
					>
						{t(AdminStaffKeys.SCHEDULE_NEXT_WEEK)}
					</button>
				</div>
				<div className="flex items-center gap-2 w-full sm:w-auto">
					<SegmentedControl
						options={shiftPresenceOptions}
						value={shiftPresenceFilter}
						onChange={setShiftPresenceFilter}
						ariaLabel={t(AdminStaffKeys.SCHEDULE_FILTER_SEGMENT_ARIA)}
						size="sm"
					/>
					<label className="relative flex items-center flex-1 sm:w-52 sm:flex-initial">
						<Search
							size={14}
							aria-hidden="true"
							className="absolute left-2 text-faint-foreground pointer-events-none"
						/>
						<input
							type="search"
							value={memberFilter}
							onChange={(e) => setMemberFilter(e.target.value)}
							placeholder={t(AdminStaffKeys.SCHEDULE_FILTER_MEMBER_PLACEHOLDER)}
							aria-label={t(AdminStaffKeys.SCHEDULE_FILTER_MEMBER_PLACEHOLDER)}
							className="w-full text-xs rounded border border-border bg-background pl-7 pr-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary/40"
						/>
					</label>
				</div>
			</div>

			{filteredMembers.length === 0 ? (
				<p className="text-sm text-faint-foreground py-6 text-center">
					{t(AdminStaffKeys.SCHEDULE_FILTER_NO_MATCHES)}
				</p>
			) : (
				<ScheduleWeekGrid
					members={filteredMembers}
					shifts={shifts}
					mondayYmd={mondayYmd}
					timezone={timezone}
					localeTag={i18n.language}
					pendingDatesByMember={pendingDatesByMember}
					approvedDatesByMember={approvedDatesByMember}
					pendingCountByMember={pendingCountByMember}
					onCreateShift={(memberId, ymd) =>
						openCreate(memberId as Id<"restaurantMembers">, ymd)
					}
					onEditShift={openEdit}
					onOpenMemberDrawer={(memberId) => setAttendanceMemberId(memberId)}
				>
					{({ shifts: cellShifts, member, absenceState }) =>
						cellShifts.map((s) => (
							<ShiftCellChip
								key={s._id}
								shift={s}
								timezone={timezone}
								absenceState={absenceState}
								onClick={() =>
									absenceState === "pending"
										? setAttendanceMemberId(member.memberId)
										: openEdit(s)
								}
							/>
						))
					}
				</ScheduleWeekGrid>
			)}

			{drawerInitial ? (
				<ShiftDrawer
					isOpen={drawerOpen}
					onClose={() => setDrawerOpen(false)}
					onSaved={refetch}
					restaurantId={restaurant._id}
					restaurantTimezone={timezone}
					members={members}
					initial={drawerInitial}
				/>
			) : null}

			{attendanceMember ? (
				<MemberAttendanceDrawer
					isOpen={attendanceMemberId !== null}
					onClose={() => setAttendanceMemberId(null)}
					restaurantId={restaurant._id}
					memberId={attendanceMember.memberId}
					memberLabel={attendanceMember.displayName || "—"}
					isSelf={myMemberId !== null && myMemberId === attendanceMember.memberId}
					canViewAsManager
					weekStartMs={weekStartMs}
					weekEndMs={weekEndMs}
					localeTag={i18n.language}
				/>
			) : null}

			<ClearSchedulesModal
				isOpen={clearModalOpen}
				onClose={() => setClearModalOpen(false)}
				onCleared={refetch}
				restaurantId={restaurant._id}
				weekStartMs={weekStartMs}
				members={members}
			/>
		</AdminPageLayout>
	);
}

interface EmployeeScheduleViewProps {
	readonly restaurant: Doc<"restaurants">;
	readonly timezone: string;
	readonly mondayYmd: string;
	readonly weekStartMs: number;
	readonly weekEndMs: number;
	readonly formatRange: string;
	readonly setAnchorMs: (updater: (prev: number) => number) => void;
	readonly myMembership: Doc<"restaurantMembers"> | null;
	readonly ownEmail: string | null;
}

function EmployeeScheduleView({
	restaurant,
	timezone,
	mondayYmd,
	weekStartMs,
	weekEndMs,
	formatRange,
	setAnchorMs,
	myMembership,
	ownEmail,
}: Readonly<EmployeeScheduleViewProps>) {
	const { t, i18n } = useTranslation();
	const [drawerOpen, setDrawerOpen] = useState(false);

	const singleRowMembers = useMemo<AssignableMember[]>(() => {
		if (!myMembership) return [];
		const dn = ownEmail?.trim() ? ownEmail : (myMembership.userId ?? "—");
		return [
			{
				memberId: myMembership._id,
				userId: myMembership.userId,
				role: myMembership.role,
				email: ownEmail,
				displayName: dn,
				photoUrl: null,
			},
		];
	}, [myMembership, ownEmail]);

	const { data: myShifts, isLoading: shiftsLoading } = useQuery({
		...convexQuery(api.shifts.listMyShifts, {
			restaurantId: restaurant._id,
			fromMs: weekStartMs,
			toMs: weekEndMs,
		}),
		select: unwrapResult<Doc<"shifts">[]>,
	});

	const adaptedShifts = useMemo<ScheduledShiftView[]>(() => {
		if (!myShifts || !myMembership) return [];
		const dn = ownEmail?.trim() ? ownEmail : (myMembership.userId ?? "—");
		const member = {
			userId: myMembership.userId,
			role: myMembership.role,
			email: ownEmail,
			displayName: dn,
			photoUrl: null as string | null,
		};
		return myShifts.map((s) => ({
			_id: s._id,
			memberId: s.memberId,
			restaurantId: s.restaurantId,
			startsAt: s.startsAt,
			endsAt: s.endsAt,
			shiftRole: s.shiftRole,
			status: s.status,
			notes: s.notes,
			templateId: s.templateId,
			publishedAt: s.publishedAt,
			member,
		}));
	}, [myShifts, myMembership, ownEmail]);

	if (!myMembership) {
		return (
			<AdminPageLayout
				title={t(SidebarKeys.SCHEDULE)}
				description={t(AdminStaffKeys.SCHEDULE_DESCRIPTION_EMPLOYEE)}
			>
				<EmptyState
					icon={CalendarRange}
					title={t(AdminStaffKeys.SCHEDULE_EMPLOYEE_EMPTY_TITLE)}
					description={t(AdminStaffKeys.SCHEDULE_EMPLOYEE_EMPTY_DESCRIPTION)}
				/>
			</AdminPageLayout>
		);
	}

	const ownLabel = ownEmail?.trim() ? ownEmail : (myMembership.userId ?? "—");
	// ownLabel is still used for the attendance drawer memberLabel prop

	return (
		<AdminPageLayout
			title={t(SidebarKeys.SCHEDULE)}
			description={t(AdminStaffKeys.SCHEDULE_DESCRIPTION_EMPLOYEE)}
		>
			<div className="flex flex-wrap items-center justify-between gap-2 mb-4">
				<div className="flex items-center gap-2">
					<button
						type="button"
						className="text-xs px-2 py-1 rounded border border-border hover:bg-(--bg-hover)"
						onClick={() => setAnchorMs((a) => a - 7 * 24 * 60 * 60 * 1000)}
					>
						{t(AdminStaffKeys.SCHEDULE_PREV_WEEK)}
					</button>
					<span className="text-xs font-medium text-foreground">{formatRange}</span>
					<button
						type="button"
						className="text-xs px-2 py-1 rounded border border-border hover:bg-(--bg-hover)"
						onClick={() => setAnchorMs((a) => a + 7 * 24 * 60 * 60 * 1000)}
					>
						{t(AdminStaffKeys.SCHEDULE_NEXT_WEEK)}
					</button>
				</div>
			</div>

			{shiftsLoading ? (
				<LoadingState />
			) : (
				<ScheduleWeekGrid
					members={singleRowMembers}
					shifts={adaptedShifts}
					mondayYmd={mondayYmd}
					timezone={timezone}
					localeTag={i18n.language}
					onOpenMemberDrawer={() => setDrawerOpen(true)}
				>
					{({ shifts: cellShifts }) =>
						cellShifts.map((s) => (
							<ShiftCellChip key={s._id} shift={s} timezone={timezone} />
						))
					}
				</ScheduleWeekGrid>
			)}

			<MemberAttendanceDrawer
				isOpen={drawerOpen}
				onClose={() => setDrawerOpen(false)}
				restaurantId={restaurant._id}
				memberId={myMembership._id}
				memberLabel={ownLabel}
				isSelf
				canViewAsManager={false}
				weekStartMs={weekStartMs}
				weekEndMs={weekEndMs}
				localeTag={i18n.language}
			/>
		</AdminPageLayout>
	);
}
