import { StripeConnectSetup } from "@/features/restaurants/components/StripeConnectSetup";
import { BillingSection } from "@/features/restaurants/components/settings/BillingSection";
import type { Doc } from "convex/_generated/dataModel";

interface PaymentsSectionProps {
	readonly restaurant: Doc<"restaurants">;
	/** Platform admins may arm/disarm the Tavli subscription; everyone else reads it. */
	readonly isAdmin: boolean;
}

/**
 * Payments for this restaurant. `StripeConnectSetup` brings its own card,
 * heading and status chrome, so this section is a stacking container: extra
 * payment blocks (e.g. Tavli billing) drop in as further children without
 * touching the Stripe component.
 *
 * The two blocks are different directions of money and must not be read as one
 * thing: Connect is how the restaurant gets PAID by diners; billing is what the
 * restaurant PAYS Tavli each month.
 *
 * TODO(TAVLI-71): the affordance is wider than the mutation. This section
 * renders for any `settingsAccess === "full"` caller (org-level owner or
 * admin), but `billing.createSubscriptionCheckout` and the Connect actions gate
 * on `requireStripeRestaurantAccess`, which admits only a platform admin or the
 * restaurant's own `ownerId`. An org owner who is not this restaurant's owner
 * therefore sees "Set up billing" and the Connect buttons and gets
 * NOT_AUTHORIZED on click. Pre-existing — the old modal rendered
 * `StripeConnectSetup` under the identical `canManage` gate — so it is left
 * as-is here rather than changed under a formatting/verification pass. The fix
 * is to gate this section on the same predicate the actions use.
 */
export function PaymentsSection({ restaurant, isAdmin }: Readonly<PaymentsSectionProps>) {
	return (
		<section data-testid="settings-section-payments" className="space-y-4">
			<StripeConnectSetup restaurantId={restaurant._id} />
			<BillingSection restaurant={restaurant} isAdmin={isAdmin} />
		</section>
	);
}
