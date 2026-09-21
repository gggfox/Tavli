import { PayoutsKeys } from "@/global/i18n";
import { getErrorMessage } from "@/global/utils/errorMessages";
import { useConvexAction } from "@convex-dev/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * "Update your bank details" — a Stripe Account Link into the hosted form
 * (TAVLI-103).
 *
 * Deliberately the **same action** `StripeConnectSetup` uses
 * (`api.stripe.createAccountLink`) rather than a new one. Bank details live on
 * the connected account and only Stripe may collect them: Tavli never sees a
 * CLABE, and a second entry point would be a second place for that boundary to
 * be got wrong. The link is minted per click because Account Links are
 * single-use and short-lived — one cannot be cached or put in an `href`.
 *
 * `returnUrl` comes back to the payouts page, so a manager who fixes their
 * account lands on the screen that will tell them the money moved. Nothing is
 * refreshed on return: the page is a Convex subscription, and the truth arrives
 * with the next `payout.*` event, not with the redirect.
 */
export function useUpdateBankDetails(restaurantId: Id<"restaurants"> | undefined) {
	const { t } = useTranslation();
	const createLink = useConvexAction(api.stripe.createAccountLink);
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const openBankDetails = useCallback(async () => {
		if (!restaurantId) return;
		setError(null);
		setIsPending(true);
		try {
			const here = `${globalThis.location.origin}${globalThis.location.pathname}`;
			const { url } = await createLink({
				restaurantId,
				returnUrl: `${here}?stripe_return=true`,
				refreshUrl: here,
			});
			globalThis.location.href = url;
		} catch (caught) {
			setError(getErrorMessage(caught, t, PayoutsKeys.HELD_FIX_FAILED));
			setIsPending(false);
		}
	}, [createLink, restaurantId, t]);

	return { openBankDetails, isPending, error };
}
