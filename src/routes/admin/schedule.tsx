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
	type AssignableMember,
	type ScheduledShiftView,
	type ShiftDrawerInitial,
} from "@/features/schedule";
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
	RESTAURANT_MEMBER_ROLE,
	SHIFT_STATUS,
	USER_ROLES,
} from "convex/constants";
import { useConvexAuth } from "convex/react";
import { CalendarRange, Users } from "lucide-react";
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

	const shifts = shiftsQuery.data ?? [];

	const draftCount = useMemo(
		() => shifts.filter((s) => s.status === SHIFT_STATUS.SCHEDULED).length,
		[shifts]
	);

	const [drawerOpen, setDrawerOpen] = useState(false);
	const [drawerInitial, setDrawerInitial] = useState<ShiftDrawerInitial | null>(null);

	const [attendanceMemberId, setAttendanceMemberId] =
		useState<Id<"restaurantMembers"> | null>(null);

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
			</div>

			<ScheduleWeekGrid
				members={members}
				shifts={shifts}
				mondayYmd={mondayYmd}
				timezone={timezone}
				localeTag={i18n.language}
				onCreateShift={(memberId, ymd) =>
					openCreate(memberId as Id<"restaurantMembers">, ymd)
				}
				onEditShift={openEdit}
				onOpenMemberDrawer={(memberId) => setAttendanceMemberId(memberId)}
			>
				{({ shifts: cellShifts }) =>
					cellShifts.map((s) => (
						<ShiftCellChip
							key={s._id}
							shift={s}
							timezone={timezone}
							onClick={() => openEdit(s)}
						/>
					))
				}
			</ScheduleWeekGrid>

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
					memberLabel={
						attendanceMember.email?.trim() ? attendanceMember.email : attendanceMember.userId
					}
					isSelf={myMemberId !== null && myMemberId === attendanceMember.memberId}
					canViewAsManager
					weekStartMs={weekStartMs}
					weekEndMs={weekEndMs}
					localeTag={i18n.language}
				/>
			) : null}
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
		return [
			{
				memberId: myMembership._id,
				userId: myMembership.userId,
				role: myMembership.role,
				email: ownEmail,
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
		const member = {
			userId: myMembership.userId,
			role: myMembership.role,
			email: ownEmail,
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

	const ownLabel = ownEmail?.trim() ? ownEmail : myMembership.userId;

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
