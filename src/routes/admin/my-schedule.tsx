import { useRestaurant } from "@/features/restaurants";
import {
	shiftRoleLabel,
	utcMsToHmInTimezone,
	utcMsToYmdInTimezone,
} from "@/features/schedule";
import { AdminPageLayout, EmptyState, LoadingState } from "@/global/components";
import { AdminStaffKeys, SidebarKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "convex/_generated/api";
import type { Doc } from "convex/_generated/dataModel";
import { CalendarRange } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/my-schedule")({
	component: MySchedulePage,
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function MySchedulePage() {
	const { t, i18n } = useTranslation();
	const { restaurant, isLoading } = useRestaurant();
	const [days, setDays] = useState<7 | 30>(7);

	const timezone = restaurant?.timezone ?? "UTC";
	const fromMs = Date.now();
	const toMs = useMemo(() => fromMs + days * MS_PER_DAY, [days, fromMs]);

	const { data: shifts, isLoading: shiftsLoading } = useQuery({
		...convexQuery(
			api.shifts.listMyShifts,
			restaurant?._id ? { restaurantId: restaurant._id, fromMs, toMs } : "skip"
		),
		select: unwrapResult<Doc<"shifts">[]>,
	});

	const dateFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(i18n.language, {
				weekday: "short",
				month: "short",
				day: "numeric",
			}),
		[i18n.language]
	);

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

	const sortedShifts = (shifts ?? [])
		.slice()
		.sort((a, b) => a.startsAt - b.startsAt);

	return (
		<AdminPageLayout
			title={t(SidebarKeys.MY_SCHEDULE)}
			description={t(AdminStaffKeys.MY_SCHEDULE_DESCRIPTION)}
		>
			<div className="flex items-center gap-2 mb-4">
				<label className="text-xs text-faint-foreground flex items-center gap-2">
					{t(AdminStaffKeys.MY_SCHEDULE_RANGE_LABEL)}
					<select
						className="rounded border border-border bg-background px-2 py-1 text-sm"
						value={days}
						onChange={(e) => setDays(Number(e.target.value) === 30 ? 30 : 7)}
					>
						<option value={7}>{t(AdminStaffKeys.MY_SCHEDULE_NEXT_7_DAYS)}</option>
						<option value={30}>{t(AdminStaffKeys.MY_SCHEDULE_NEXT_30_DAYS)}</option>
					</select>
				</label>
			</div>

			{shiftsLoading && <LoadingState />}
			{!shiftsLoading && sortedShifts.length === 0 && (
				<EmptyState
					icon={CalendarRange}
					title={t(AdminStaffKeys.MY_SCHEDULE_EMPTY_TITLE)}
					description={t(AdminStaffKeys.MY_SCHEDULE_EMPTY_DESCRIPTION)}
				/>
			)}
			{!shiftsLoading && sortedShifts.length > 0 && (
				<div className="overflow-x-auto rounded border border-border">
					<table className="w-full text-sm">
						<thead className="bg-muted text-left text-xs uppercase text-faint-foreground">
							<tr>
								<th className="p-2">{t(AdminStaffKeys.MY_SCHEDULE_COL_DATE)}</th>
								<th className="p-2">{t(AdminStaffKeys.MY_SCHEDULE_COL_TIME)}</th>
								<th className="p-2">{t(AdminStaffKeys.MY_SCHEDULE_COL_ROLE)}</th>
								<th className="p-2">{t(AdminStaffKeys.MY_SCHEDULE_COL_NOTES)}</th>
							</tr>
						</thead>
						<tbody>
							{sortedShifts.map((s) => {
								const ymd = utcMsToYmdInTimezone(s.startsAt, timezone);
								const dateStr = dateFormatter.format(new Date(`${ymd}T00:00:00Z`));
								const start = utcMsToHmInTimezone(s.startsAt, timezone);
								const end = utcMsToHmInTimezone(s.endsAt, timezone);
								return (
									<tr key={s._id} className="border-t border-border">
										<td className="p-2 whitespace-nowrap">{dateStr}</td>
										<td className="p-2 font-mono text-xs whitespace-nowrap">
											{start} – {end}
										</td>
										<td className="p-2">
											{s.shiftRole ? shiftRoleLabel(s.shiftRole, t) : "—"}
										</td>
										<td className="p-2 text-muted-foreground">
											{s.notes ?? ""}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
		</AdminPageLayout>
	);
}
