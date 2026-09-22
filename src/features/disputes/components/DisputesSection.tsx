import { Surface } from "@/global/components";
import { DisputesKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { Scale } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDisputeMoney } from "../constants";
import { DisputeRow } from "./DisputeRow";

type DisputesPageData = NonNullable<
	Awaited<FunctionReturnType<typeof api.disputes.listByRestaurant>>[0]
>;

export interface DisputesSectionProps {
	readonly restaurantId: Id<"restaurants">;
}

/**
 * The disputes card on `/admin/payments` (TAVLI-102).
 *
 * Lives on the payments page rather than getting a page of its own, and that
 * is the point: a chargeback is invisible in the payments ledger — every charge
 * in it succeeded — so the one place a manager wonders about their money is
 * exactly where this has to appear. A restaurant that has never had a dispute
 * sees nothing at all; a card explaining a thing that has not happened is
 * noise on the busiest page in the product.
 *
 * `api.disputes.listByRestaurant` is gated on `requireRestaurantManagerOrAbove`,
 * the same gate as the payments page itself. There is no client-side role check
 * here on purpose — the backend refusing is the authorization, and a UI check
 * would only be a second, drift-prone copy of it. The query also reports
 * whether the caller is a platform admin, which is what adds the ledger line to
 * each row.
 */
export function DisputesSection({ restaurantId }: DisputesSectionProps) {
	const { t } = useTranslation();

	const { data } = useQuery({
		...convexQuery(api.disputes.listByRestaurant, { restaurantId }),
		select: unwrapResult<DisputesPageData>,
	});

	// Nothing while loading or refused, and nothing for a restaurant with a
	// clean history: a card that flickers in and out on every navigation is
	// worse than one that appears a beat late.
	if (!data || data.rows.length === 0) return null;

	const { recovery } = data;
	const isRecovering = recovery.percent > 0 && recovery.totalOutstanding > 0;

	return (
		<section className="space-y-3" data-testid="disputes-section">
			<div className="flex items-center gap-2">
				<span className="text-faint-foreground">
					<Scale size={16} />
				</span>
				<h3 className="text-sm font-semibold text-muted-foreground">
					{t(DisputesKeys.SECTION_TITLE)}
				</h3>
			</div>
			<p className="text-xs text-faint-foreground">{t(DisputesKeys.SECTION_DESCRIPTION)}</p>

			{/*
			 * The recovery summary only exists while money is actually being held
			 * back. With recovery off, or with the ledger clear, there is no
			 * ongoing deduction to explain and the rows say the rest.
			 */}
			{isRecovering && (
				<Surface
					tone="secondary"
					rounded="xl"
					className="p-4 space-y-1"
					data-testid="dispute-recovery-card"
				>
					<p className="text-sm font-semibold text-foreground">{t(DisputesKeys.RECOVERY_TITLE)}</p>
					<p className="text-xs text-muted-foreground">
						{t(DisputesKeys.RECOVERY_BODY, { percent: recovery.percent })}
					</p>
					<p className="text-sm text-foreground">
						{t(DisputesKeys.RECOVERY_OUTSTANDING, {
							amount: formatDisputeMoney(recovery.totalOutstanding, recovery.currency),
						})}
					</p>
					{recovery.totalRecovered > 0 && (
						<p className="text-xs text-muted-foreground">
							{t(DisputesKeys.RECOVERY_RECOVERED, {
								amount: formatDisputeMoney(recovery.totalRecovered, recovery.currency),
							})}
						</p>
					)}
				</Surface>
			)}

			{data.rows.map((dispute) => (
				<DisputeRow
					key={dispute.stripeDisputeId}
					dispute={dispute}
					recoveryPercent={recovery.percent}
					showLedger={data.isAdmin}
				/>
			))}
		</section>
	);
}
