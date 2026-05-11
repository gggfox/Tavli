import { MemberAttendanceDrawer } from "@/features/attendance";
import { useRestaurant } from "@/features/restaurants";
import {
	ScheduleWeekGrid,
	ShiftCellChip,
	getMondayYmdOfWeek,
	startOfDayMs,
	endOfWeekMs,
	type AssignableMember,
	type ScheduledShiftView,
} from "@/features/schedule";
import { AdminPageLayout, EmptyState, LoadingState } from "@/global/components";
import { AdminStaffKeys, SidebarKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { useAuth, useUser } from "@clerk/tanstack-react-start";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "convex/_generated/api";
import type { Doc } from "convex/_generated/dataModel";
import { RESTAURANT_MEMBER_ROLE } from "convex/constants";
import { useConvexAuth } from "convex/react";
import { CalendarRange } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/my-schedule")({
	component: MySchedulePage,
});

const DEFAULT_TIMEZONE = "UTC";

function MySchedulePage() {
	const { t, i18n } = useTranslation();
	const { restaurant, isLoading } = useRestaurant();
	const { isAuthenticated } = useConvexAuth();
	const { userId } = useAuth();
	const { user } = useUser();

	const timezone = restaurant?.timezone ?? DEFAULT_TIMEZONE;
	const [anchorMs, setAnchorMs] = useState(() => Date.now());
	const [drawerOpen, setDrawerOpen] = useState(false);

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

	const ownEmail = user?.primaryEmailAddress?.emailAddress ?? null;

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
		...convexQuery(
			api.shifts.listMyShifts,
			restaurant?._id
				? { restaurantId: restaurant._id, fromMs: weekStartMs, toMs: weekEndMs }
				: "skip"
		),
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

	const isManagerOrAbove =
		myMembership?.role === RESTAURANT_MEMBER_ROLE.MANAGER;

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
				title={t(SidebarKeys.MY_SCHEDULE)}
				description={t(AdminStaffKeys.MY_SCHEDULE_DESCRIPTION_NO_RESTAURANT)}
			>
				<p className="text-sm text-faint-foreground">
					{t(AdminStaffKeys.MY_SCHEDULE_NO_RESTAURANT)}
				</p>
			</AdminPageLayout>
		);
	}

	if (!myMembership || !userId) {
		return (
			<AdminPageLayout
				title={t(SidebarKeys.MY_SCHEDULE)}
				description={t(AdminStaffKeys.MY_SCHEDULE_DESCRIPTION)}
			>
				<EmptyState
					icon={CalendarRange}
					title={t(AdminStaffKeys.MY_SCHEDULE_EMPTY_TITLE)}
					description={t(AdminStaffKeys.MY_SCHEDULE_EMPTY_DESCRIPTION)}
				/>
			</AdminPageLayout>
		);
	}

	const ownLabel = ownEmail?.trim() ? ownEmail : myMembership.userId;

	return (
		<AdminPageLayout
			title={t(SidebarKeys.MY_SCHEDULE)}
			description={t(AdminStaffKeys.MY_SCHEDULE_DESCRIPTION)}
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
				canViewAsManager={isManagerOrAbove}
				weekStartMs={weekStartMs}
				weekEndMs={weekEndMs}
				localeTag={i18n.language}
			/>
		</AdminPageLayout>
	);
}
