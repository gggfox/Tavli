import { useRestaurant } from "@/features/restaurants";
import { AdminPageLayout, LoadingState } from "@/global/components";
import { AdminStaffKeys, SidebarKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { convexQuery } from "@convex-dev/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/performance")({
	component: AdminPerformancePage,
});

function AdminPerformancePage() {
	const { t } = useTranslation();
	const { restaurant, isLoading } = useRestaurant();
	const [rangeDays, setRangeDays] = useState(30);
	const toMs = Date.now();
	const fromMs = useMemo(() => toMs - rangeDays * 24 * 60 * 60 * 1000, [rangeDays, toMs]);

	const { data: perf } = useQuery({
		...convexQuery(
			api.performance.getRestaurantPerformance,
			restaurant?._id ? { restaurantId: restaurant._id, fromMs, toMs } : "skip"
		),
		select: unwrapResult,
	});

	if (isLoading) return <LoadingState />;

	if (!restaurant) {
		return (
			<AdminPageLayout
				title={t(SidebarKeys.PERFORMANCE)}
				description={t(AdminStaffKeys.PERFORMANCE_DESCRIPTION_NO_RESTAURANT)}
			>
				<p className="text-sm text-faint-foreground">{t(AdminStaffKeys.PERFORMANCE_NO_RESTAURANT)}</p>
			</AdminPageLayout>
		);
	}

	const rows = perf?.rows ?? [];

	return (
		<AdminPageLayout
			title={t(SidebarKeys.PERFORMANCE)}
			description={t(AdminStaffKeys.PERFORMANCE_DESCRIPTION)}
		>
			<div className="flex items-center gap-2 mb-4">
				<label className="text-xs text-faint-foreground flex items-center gap-2">
					{t(AdminStaffKeys.PERFORMANCE_RANGE_LABEL)}
					<select
						className="rounded border border-border bg-background px-2 py-1 text-sm"
						value={rangeDays}
						onChange={(e) => setRangeDays(Number(e.target.value))}
					>
						<option value={7}>{t(AdminStaffKeys.PERFORMANCE_RANGE_7)}</option>
						<option value={30}>{t(AdminStaffKeys.PERFORMANCE_RANGE_30)}</option>
						<option value={90}>{t(AdminStaffKeys.PERFORMANCE_RANGE_90)}</option>
					</select>
				</label>
			</div>

			{rows.length === 0 ? (
				<p className="text-sm text-faint-foreground">{t(AdminStaffKeys.PERFORMANCE_EMPTY)}</p>
			) : (
				<div className="overflow-x-auto rounded border border-border">
					<table className="w-full text-sm">
						<thead className="bg-muted text-left text-xs uppercase text-faint-foreground">
							<tr>
								<th className="p-2">{t(AdminStaffKeys.PERFORMANCE_COL_MEMBER)}</th>
								<th className="p-2">{t(AdminStaffKeys.PERFORMANCE_COL_PAID_ORDERS)}</th>
								<th className="p-2">{t(AdminStaffKeys.PERFORMANCE_COL_ATTRIBUTED_REVENUE)}</th>
								<th className="p-2">{t(AdminStaffKeys.PERFORMANCE_COL_HOURS)}</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((r) => (
								<tr key={r.memberId} className="border-t border-border">
									<td className="p-2 font-mono text-xs">{r.memberId}</td>
									<td className="p-2">{r.paidOrders}</td>
									<td className="p-2">
										{r.attributedRevenue.toFixed(2)} {restaurant.currency}
									</td>
									<td className="p-2">{r.hoursWorked.toFixed(2)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</AdminPageLayout>
	);
}
