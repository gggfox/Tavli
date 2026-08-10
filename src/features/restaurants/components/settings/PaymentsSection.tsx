import { StripeConnectSetup } from "@/features/restaurants/components/StripeConnectSetup";
import { BillingSection } from "@/features/restaurants/components/settings/BillingSection";
import { Skeleton } from "@/global/components";
import { useUser } from "@clerk/tanstack-react-start";
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
 * ## Why this mirrors `requireStripeRestaurantAccess`
 *
 * Every control in here — Connect onboarding, the billing checkout, the billing
 * portal — is gated server-side by `convex/_util/stripe.ts#requireStripeRestaurantAccess`,
 * which admits a **platform admin** or the restaurant's **own `ownerId`** and
 * nobody else. The settings canvas opens at `settingsAccess === "full"` for any
 * org-level owner, so rendering this section on that broader predicate showed an
 * org owner who does not own *this* restaurant a full set of buttons that answer
 * NOT_AUTHORIZED on click. The section is therefore hidden rather than shown
 * inert: everything in it is an action surface, and a disabled Connect/billing
 * card carries no information worth the confusion.
 *
 * "Hidden" is a decision, not a default: until Clerk resolves the user we do
 * not yet know whether this viewer is the owner, so the section renders a
 * placeholder of its own height rather than nothing. Returning `null` while
 * `isLoaded` is false made the owner's own Connect/billing card blink in after
 * first paint, and pushed the page around when it did.
 */
export function PaymentsSection({ restaurant, isAdmin }: Readonly<PaymentsSectionProps>) {
	const { user, isLoaded } = useUser();
	if (!isAdmin && !isLoaded) {
		return (
			<section data-testid="settings-section-payments-loading" aria-busy="true">
				<Skeleton className="h-40 w-full" rounded="xl" />
			</section>
		);
	}
	const canActOnStripe = isAdmin || (user?.id != null && restaurant.ownerId === user.id);
	if (!canActOnStripe) return null;

	return (
		<section data-testid="settings-section-payments" className="space-y-4">
			<StripeConnectSetup restaurantId={restaurant._id} />
			<BillingSection restaurant={restaurant} isAdmin={isAdmin} />
		</section>
	);
}
