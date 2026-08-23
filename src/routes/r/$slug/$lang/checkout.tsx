import { OrderCheckoutPage, TabCheckoutPage } from "@/features/ordering";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";

export const Route = createFileRoute("/r/$slug/$lang/checkout")({
	// Present → per-order pay-at-submit checkout (ADR 008). Absent → the
	// legacy whole-tab checkout, reachable only from a pre-pivot session's
	// Pay-tab CTA. Optional (not `string | undefined`) so legacy callers can
	// navigate without a `search` object at all.
	validateSearch: (search: Record<string, unknown>): { orderId?: string } => ({
		...(typeof search.orderId === "string" ? { orderId: search.orderId } : {}),
	}),
	component: Page,
});

function Page() {
	const { slug, lang } = Route.useParams();
	const { orderId } = Route.useSearch();
	const navigate = useNavigate();

	if (orderId) {
		return (
			<OrderCheckoutPage
				orderId={orderId as Id<"orders">}
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
