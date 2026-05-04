import { useRestaurant } from "@/features/restaurants";
import {
	PublishWeekButton,
	ScheduleListView,
	ScheduleWeekGrid,
	ShiftCellChip,
	ShiftDrawer,
	getMondayYmdOfWeek,
	startOfDayMs,
	endOfWeekMs,
	useAssignableMembers,
	type ScheduledShiftView,
	type ShiftDrawerInitial,
} from "@/features/schedule";
import { AdminPageLayout, LoadingState, SegmentedControl } from "@/global/components";
import { useIsNarrowViewport } from "@/global/hooks";
import { AdminStaffKeys, SidebarKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { SHIFT_STATUS } from "convex/constants";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/schedule")({
	component: AdminSchedulePage,
});

const DEFAULT_TIMEZONE = "UTC";

function AdminSchedulePage() {
	const { t, i18n } = useTranslation();
	const { restaurant, isLoading } = useRestaurant();
	const queryClient = useQueryClient();
	const isNarrow = useIsNarrowViewport();

	const timezone = restaurant?.timezone ?? DEFAULT_TIMEZONE;
	const [anchorMs, setAnchorMs] = useState(() => Date.now());
	const [view, setView] = useState<"grid" | "list">("grid");
	useEffect(() => {
		if (isNarrow) setView("list");
	}, [isNarrow]);

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

	const { members } = useAssignableMembers(restaurant?._id);

	const shiftsQueryArgs = restaurant?._id
		? { restaurantId: restaurant._id, weekStartMs }
		: ("skip" as const);
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
			queryKey: convexQuery(api.shifts.listForRestaurantWeek, shiftsQueryArgs).queryKey,
		});
	};

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
				<p className="text-sm text-faint-foreground">{t(AdminStaffKeys.SCHEDULE_NO_RESTAURANT)}</p>
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

				<SegmentedControl<"grid" | "list">
					value={view}
					onChange={setView}
					options={[
						{ value: "grid", label: t(AdminStaffKeys.SCHEDULE_VIEW_GRID) },
						{ value: "list", label: t(AdminStaffKeys.SCHEDULE_VIEW_LIST) },
					]}
					ariaLabel={t(AdminStaffKeys.SCHEDULE_VIEW_GRID)}
				/>
			</div>

			{view === "grid" ? (
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
			) : (
				<ScheduleListView
					members={members}
					shifts={shifts}
					mondayYmd={mondayYmd}
					timezone={timezone}
					localeTag={i18n.language}
					onCreateShift={(memberId, ymd) =>
						openCreate(memberId as Id<"restaurantMembers">, ymd)
					}
					onEditShift={openEdit}
				/>
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
		</AdminPageLayout>
	);
}
