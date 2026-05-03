import { useRestaurant } from "@/features/restaurants";
import { AdminPageLayout, LoadingState } from "@/global/components";
import { AdminStaffKeys, SidebarKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { convexQuery } from "@convex-dev/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import { SHIFT_STATUS } from "convex/constants";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/schedule")({
	component: AdminSchedulePage,
});

function AdminSchedulePage() {
	const { t } = useTranslation();
	const { restaurant, isLoading } = useRestaurant();
	const [anchor, setAnchor] = useState(() => Date.now());

	const fromMs = useMemo(() => anchor - 3 * 24 * 60 * 60 * 1000, [anchor]);
	const toMs = useMemo(() => anchor + 11 * 24 * 60 * 60 * 1000, [anchor]);

	const { data: shifts } = useQuery({
		...convexQuery(
			api.shifts.listForRestaurant,
			restaurant?._id ? { restaurantId: restaurant._id, fromMs, toMs } : "skip"
		),
		select: unwrapResult,
	});

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

	const shiftStatusLabel = (status: string) => {
		if (status === SHIFT_STATUS.PUBLISHED) return t(AdminStaffKeys.SCHEDULE_STATUS_PUBLISHED);
		if (status === SHIFT_STATUS.CANCELLED) return t(AdminStaffKeys.SCHEDULE_STATUS_CANCELLED);
		return t(AdminStaffKeys.SCHEDULE_STATUS_SCHEDULED);
	};

	return (
		<AdminPageLayout
			title={t(SidebarKeys.SCHEDULE)}
			description={t(AdminStaffKeys.SCHEDULE_DESCRIPTION)}
		>
			<div className="flex flex-wrap items-center gap-2 mb-4">
				<button
					type="button"
					className="text-xs px-2 py-1 rounded border border-border"
					onClick={() => setAnchor((a) => a - 7 * 24 * 60 * 60 * 1000)}
				>
					{t(AdminStaffKeys.SCHEDULE_PREV_WEEK)}
				</button>
				<button
					type="button"
					className="text-xs px-2 py-1 rounded border border-border"
					onClick={() => setAnchor((a) => a + 7 * 24 * 60 * 60 * 1000)}
				>
					{t(AdminStaffKeys.SCHEDULE_NEXT_WEEK)}
				</button>
			</div>
			{!shifts?.length ? (
				<p className="text-sm text-faint-foreground">{t(AdminStaffKeys.SCHEDULE_EMPTY)}</p>
			) : (
				<div className="overflow-x-auto rounded border border-border">
					<table className="w-full text-sm">
						<thead className="bg-muted text-left text-xs uppercase text-faint-foreground">
							<tr>
								<th className="p-2">{t(AdminStaffKeys.SCHEDULE_COL_MEMBER)}</th>
								<th className="p-2">{t(AdminStaffKeys.SCHEDULE_COL_START)}</th>
								<th className="p-2">{t(AdminStaffKeys.SCHEDULE_COL_END)}</th>
								<th className="p-2">{t(AdminStaffKeys.SCHEDULE_COL_STATUS)}</th>
							</tr>
						</thead>
						<tbody>
							{shifts
								.slice()
								.sort((a, b) => a.startsAt - b.startsAt)
								.map((s) => (
									<tr key={s._id} className="border-t border-border">
										<td className="p-2 font-mono text-xs">{s.memberId}</td>
										<td className="p-2">{new Date(s.startsAt).toLocaleString()}</td>
										<td className="p-2">{new Date(s.endsAt).toLocaleString()}</td>
										<td className="p-2">{shiftStatusLabel(s.status)}</td>
									</tr>
								))}
						</tbody>
					</table>
				</div>
			)}
		</AdminPageLayout>
	);
}
