import { TabCheckoutPage } from "@/features/ordering";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/r/$slug/$lang/checkout")({
	component: Page,
});

function Page() {
	const { slug, lang } = Route.useParams();
	const navigate = useNavigate();

	return (
		<TabCheckoutPage
			onBackToTab={() => navigate({ to: "/r/$slug/$lang/orders", params: { slug, lang } })}
			onDone={() => navigate({ to: "/r/$slug/$lang/menu", params: { slug, lang } })}
		/>
	);
}
