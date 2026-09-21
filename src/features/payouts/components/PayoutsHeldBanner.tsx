import { Surface } from "@/global/components";
import { PayoutsKeys } from "@/global/i18n";
import { unwrapResult } from "@/global/utils";
import { formatCents } from "@/global/utils/money";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PAYOUTS_ROUTE } from "../constants";

type HeldTotal = NonNullable<Awaited<FunctionReturnType<typeof api.payouts.getHeldTotal>>[0]>;

export interface PayoutsHeldBannerProps {
	readonly restaurantId: Id<"restaurants">;
}

/**
 * The line on `/admin/payments` that says money has not reached the bank
 * (TAVLI-103).
 *
 * Lives on the payments page because that is where a manager goes when they are
 * wondering about money, and a failed payout is exactly the thing the payments
 * ledger cannot show them: those charges all succeeded. The banner does not try
 * to explain the failure — it says the money is safe and links to the page that
 * does.
 *
 * `api.payouts.getHeldTotal` rather than the full list: this renders on every
 * visit to the payments page, and pulling two hundred payout rows to decide
 * whether to show one line would be a real cost on the page a restaurant opens
 * most. It renders nothing at all while nothing is held, and nothing while the
 * query is loading or refused — a banner that flickers in and out on every
 * navigation is worse than one that appears a beat late.
 */
export function PayoutsHeldBanner({ restaurantId }: PayoutsHeldBannerProps) {
	const { t } = useTranslation();

	const { data } = useQuery({
		...convexQuery(api.payouts.getHeldTotal, { restaurantId }),
		select: unwrapResult<HeldTotal>,
	});

	if (!data || data.heldCents <= 0) return null;

	return (
		<Surface
			tone="secondary"
			rounded="xl"
			className="p-4 flex flex-wrap items-start justify-between gap-3"
			data-testid="payouts-held-banner"
		>
			<div className="flex items-start gap-3 min-w-0">
				<span className="text-success mt-0.5 shrink-0">
					<ShieldCheck size={18} />
				</span>
				<div className="min-w-0">
					<p className="text-sm font-semibold text-foreground">
						{t(PayoutsKeys.BANNER_TITLE, {
							amount: formatCents(data.heldCents),
							currency: data.currency,
						})}
					</p>
					<p className="text-xs text-muted-foreground">{t(PayoutsKeys.BANNER_BODY)}</p>
				</div>
			</div>

			<Link to={PAYOUTS_ROUTE} className="text-sm font-medium underline text-foreground shrink-0">
				{t(PayoutsKeys.BANNER_CTA)}
			</Link>
		</Surface>
	);
}
