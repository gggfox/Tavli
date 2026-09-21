import { DashboardShell, EmptyState, Skeleton } from "@/global/components";
import { PayoutsKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { Banknote, Landmark } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HeldTotalCard } from "./HeldTotalCard";
import { PayoutRow } from "./PayoutRow";

type PayoutsPageData = NonNullable<
	Awaited<FunctionReturnType<typeof api.payouts.listByRestaurant>>[0]
>;

export interface PayoutsDashboardProps {
	readonly restaurantId: Id<"restaurants">;
}

/**
 * `/admin/payouts` — where the restaurant's own money is (TAVLI-103).
 *
 * The page answers one question in one screen: *has my money arrived, and if
 * not, why not and what do I do?* So the held-total card is at the top and only
 * exists while something is stuck, and the list below is every payout newest
 * first — arrived ones included, because "the last four arrived fine" is itself
 * the reassurance when the fifth did not.
 *
 * `api.payouts.listByRestaurant` is gated on `requireRestaurantManagerOrAbove`,
 * the same gate as the payments page: a payout is the restaurant's bank account,
 * which an employee has no business reading. There is no client-side role check
 * here on purpose — the backend refusing is the authorization, and a UI check
 * would only be a second, drift-prone copy of it.
 */
export function PayoutsDashboard({ restaurantId }: PayoutsDashboardProps) {
	const { t } = useTranslation();

	const {
		data,
		isPending,
		error: queryError,
	} = useQuery({
		...convexQuery(api.payouts.listByRestaurant, { restaurantId }),
		select: unwrapResult<PayoutsPageData>,
	});

	const rows = data?.rows ?? [];
	const heldCents = data?.held.heldCents ?? 0;
	const failedCount = data?.held.unresolvedPayoutIds.length ?? 0;

	return (
		<DashboardShell
			isLoading={isPending}
			error={queryError}
			entityName="payouts"
			skeleton={<PayoutsDashboardSkeleton />}
			gap="5"
		>
			{heldCents > 0 && (
				<HeldTotalCard
					restaurantId={restaurantId}
					heldCents={heldCents}
					currency={data?.held.currency ?? ""}
					failedCount={failedCount}
				/>
			)}

			{rows.length === 0 ? (
				<EmptyState
					icon={data?.hasStripeAccount ? Banknote : Landmark}
					title={t(
						data?.hasStripeAccount ? PayoutsKeys.EMPTY_TITLE : PayoutsKeys.NOT_CONNECTED_TITLE
					)}
					description={t(
						data?.hasStripeAccount
							? PayoutsKeys.EMPTY_DESCRIPTION
							: PayoutsKeys.NOT_CONNECTED_DESCRIPTION
					)}
				/>
			) : (
				<section className="space-y-3">
					<h3 className="text-sm font-semibold text-muted-foreground">
						{t(PayoutsKeys.LIST_TITLE)}
					</h3>
					{rows.map((payout) => (
						<PayoutRow key={payout.stripePayoutId} payout={payout} />
					))}
				</section>
			)}
		</DashboardShell>
	);
}

export function PayoutsDashboardSkeleton() {
	return (
		<div className="space-y-4">
			<Skeleton className="h-28 w-full rounded-xl" />
			<Skeleton className="h-20 w-full rounded-lg" />
			<Skeleton className="h-20 w-full rounded-lg" />
			<Skeleton className="h-20 w-full rounded-lg" />
		</div>
	);
}
