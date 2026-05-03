import { useRestaurant } from "@/features/restaurants";
import { AdminPageLayout, AppDatePicker, LoadingState } from "@/global/components";
import { todayLocalYmd } from "@/global/utils/calendarMonth";
import { AdminStaffKeys, SidebarKeys } from "@/global/i18n";
import { unwrapResult, type UnwrappedValue } from "@/global/utils/unwrapResult";
import type { FunctionReturnType } from "convex/server";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import { TIP_ENTRY_SOURCE, TIP_POOL_STATUS } from "convex/constants";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const tipsDatePickerId = "tips-business-date";

type TipPoolForDate = UnwrappedValue<FunctionReturnType<typeof api.tips.getTipPoolForDate>>;

export const Route = createFileRoute("/admin/tips")({
	component: AdminTipsPage,
});

function AdminTipsPage() {
	const { t, i18n } = useTranslation();
	const { restaurant, isLoading } = useRestaurant();
	const [businessDate, setBusinessDate] = useState(todayLocalYmd);
	const [amount, setAmount] = useState("");
	const [notes, setNotes] = useState("");

	const { data: poolData, refetch } = useQuery({
		...convexQuery(
			api.tips.getTipPoolForDate,
			restaurant?._id ? { restaurantId: restaurant._id, businessDate } : "skip"
		),
		select: unwrapResult<TipPoolForDate>,
	});

	const addTip = useMutation({ mutationFn: useConvexMutation(api.tips.addTipEntry) });
	const finalize = useMutation({ mutationFn: useConvexMutation(api.tips.finalizeTipPool) });

	const onAddCash = async () => {
		if (!restaurant) return;
		const cents = Math.round(Number.parseFloat(amount) * 100);
		if (!Number.isFinite(cents) || cents <= 0) return;
		unwrapResult(
			await addTip.mutateAsync({
				restaurantId: restaurant._id,
				businessDate,
				amountCents: cents,
				source: TIP_ENTRY_SOURCE.CASH,
				notes: notes || undefined,
			})
		);
		setAmount("");
		setNotes("");
		void refetch();
	};

	const onFinalize = async () => {
		if (!restaurant) return;
		unwrapResult(
			await finalize.mutateAsync({
				restaurantId: restaurant._id,
				businessDate,
			})
		);
		void refetch();
	};

	const tipPoolStatusLabel = (status: string) => {
		if (status === TIP_POOL_STATUS.FINALIZED) return t(AdminStaffKeys.TIPS_STATUS_FINALIZED);
		if (status === TIP_POOL_STATUS.PAID) return t(AdminStaffKeys.TIPS_STATUS_PAID);
		if (status === TIP_POOL_STATUS.OPEN) return t(AdminStaffKeys.TIPS_STATUS_OPEN);
		return status;
	};

	if (isLoading) return <LoadingState />;

	if (!restaurant) {
		return (
			<AdminPageLayout
				title={t(SidebarKeys.TIPS)}
				description={t(AdminStaffKeys.TIPS_DESCRIPTION_NO_RESTAURANT)}
			>
				<p className="text-sm text-faint-foreground">{t(AdminStaffKeys.TIPS_NO_RESTAURANT)}</p>
			</AdminPageLayout>
		);
	}

	const pool = poolData?.pool;
	const shares = poolData?.shares ?? [];
	const fmtMoney = (cents: number) => (cents / 100).toFixed(2);

	return (
		<AdminPageLayout title={t(SidebarKeys.TIPS)} description={t(AdminStaffKeys.TIPS_DESCRIPTION)}>
			<div className="max-w-lg space-y-6">
				<AppDatePicker
					id={tipsDatePickerId}
					label={t(AdminStaffKeys.TIPS_BUSINESS_DATE_LABEL)}
					value={businessDate}
					onChange={setBusinessDate}
					localeTag={i18n.language}
				/>

				{pool && (
					<div className="rounded border border-border p-3 text-sm space-y-1">
						<div>
							{t(AdminStaffKeys.TIPS_TOTAL_POOL, {
								amount: fmtMoney(pool.totalAmountCents),
								currency: restaurant.currency,
							})}
						</div>
						<div>
							{t(AdminStaffKeys.TIPS_STATUS_LABEL)} {tipPoolStatusLabel(pool.status)}
						</div>
					</div>
				)}

				<div className="rounded border border-border p-3 space-y-2">
					<h2 className="text-sm font-semibold">{t(AdminStaffKeys.TIPS_ADD_CASH_TITLE)}</h2>
					<input
						className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
						placeholder={t(AdminStaffKeys.TIPS_PLACEHOLDER_AMOUNT)}
						value={amount}
						onChange={(e) => setAmount(e.target.value)}
						type="number"
						step="0.01"
						min="0"
					/>
					<input
						className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
						placeholder={t(AdminStaffKeys.TIPS_PLACEHOLDER_NOTES)}
						value={notes}
						onChange={(e) => setNotes(e.target.value)}
					/>
					<button
						type="button"
						onClick={() => void onAddCash()}
						disabled={addTip.isPending}
						className="text-sm font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground disabled:opacity-50"
					>
						{addTip.isPending ? t(AdminStaffKeys.TIPS_SAVING) : t(AdminStaffKeys.TIPS_ADD_TO_POOL)}
					</button>
				</div>

				<button
					type="button"
					onClick={() => void onFinalize()}
					disabled={finalize.isPending || pool?.status === TIP_POOL_STATUS.FINALIZED}
					className="text-sm font-medium px-3 py-1.5 rounded-md border border-border hover:bg-(--bg-hover) disabled:opacity-50"
				>
					{finalize.isPending ? t(AdminStaffKeys.TIPS_FINALIZING) : t(AdminStaffKeys.TIPS_FINALIZE)}
				</button>

				{shares.length > 0 && (
					<div>
						<h2 className="text-sm font-semibold mb-2">{t(AdminStaffKeys.TIPS_SHARES)}</h2>
						<ul className="text-sm space-y-1">
							{shares.map((s) => (
								<li key={s._id} className="flex justify-between gap-2">
									<span className="font-mono text-xs">{s.memberId}</span>
									<span>
										{fmtMoney(s.amountCents)} · {(s.sharePercent * 100).toFixed(1)}%
									</span>
								</li>
							))}
						</ul>
					</div>
				)}
			</div>
		</AdminPageLayout>
	);
}
