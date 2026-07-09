import { CustomerMenuPage } from "@/features/ordering";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/r/$slug/$lang/menu")({
	component: Page,
});

function Page() {
	const { slug, lang } = Route.useParams();
	const navigate = useNavigate();

	return (
		<CustomerMenuPage
			slug={slug}
			lang={lang}
			onOrderSubmitted={() =>
				// Orders go straight to the kitchen; the tab view shows the running
				// balance and the pay CTA (TAVLI-6).
				navigate({ to: "/r/$slug/$lang/orders", params: { slug, lang } })
			}
		/>
	);
}
