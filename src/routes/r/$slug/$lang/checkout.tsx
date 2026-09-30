import { OrderCheckoutPage, TabCheckoutPage } from "@/features/ordering";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";

interface CheckoutSearch {
	orderId?: string;
	/**
	 * Appended by Stripe to `return_url` when a payment method had to leave the
	 * page (a redirect-based 3-D Secure challenge). Kept so the checkout can
	 * tell "the diner just came back from their bank" apart from a fresh
	 * visit. The client secret Stripe also appends is deliberately dropped.
	 */
	payment_intent?: string;
	redirect_status?: string;
}

const optionalString = (value: unknown, key: keyof CheckoutSearch) =>
	typeof value === "string" ? { [key]: value } : {};

export const Route = createFileRoute("/r/$slug/$lang/checkout")({
	// Present → per-order pay-at-submit checkout (ADR 008). Absent → the
	// legacy whole-tab checkout, reachable only from a pre-pivot session's
	// Pay-tab CTA. Optional (not `string | undefined`) so legacy callers can
	// navigate without a `search` object at all.
	validateSearch: (search: Record<string, unknown>): CheckoutSearch => ({
		...optionalString(search.orderId, "orderId"),
		...optionalString(search.payment_intent, "payment_intent"),
		...optionalString(search.redirect_status, "redirect_status"),
	}),
	component: Page,
});

function Page() {
	const { slug, lang } = Route.useParams();
	const { orderId, payment_intent, redirect_status } = Route.useSearch();
	const navigate = useNavigate();

	if (orderId) {
		return (
			<OrderCheckoutPage
				orderId={orderId as Id<"orders">}
				stripeRedirect={
					payment_intent && redirect_status
						? { paymentIntentId: payment_intent, status: redirect_status }
						: undefined
				}
				onBackToMenu={() => navigate({ to: "/r/$slug/$lang/menu", params: { slug, lang } })}
				onViewOrders={() => navigate({ to: "/r/$slug/$lang/orders", params: { slug, lang } })}
			/>
		);
	}

	return (
		<TabCheckoutPage
			onBackToTab={() => navigate({ to: "/r/$slug/$lang/orders", params: { slug, lang } })}
			onDone={() => navigate({ to: "/r/$slug/$lang/menu", params: { slug, lang } })}
		/>
	);
}
