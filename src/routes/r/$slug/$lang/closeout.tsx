import { VisitCloseoutPage } from "@/features/ordering";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

/**
 * Visit close-out (ADR 008, TAVLI-71 Phase 3B): the per-member post-visit tip
 * screen, then session close. Reached from the session orders list's
 * "Close out & tip" CTA.
 */
export const Route = createFileRoute("/r/$slug/$lang/closeout")({
	component: Page,
});

function Page() {
	const { slug, lang } = Route.useParams();
	const navigate = useNavigate();

	return (
		<VisitCloseoutPage
			onBackToOrders={() => navigate({ to: "/r/$slug/$lang/orders", params: { slug, lang } })}
			onDone={() => navigate({ to: "/r/$slug/$lang/menu", params: { slug, lang } })}
		/>
	);
}
