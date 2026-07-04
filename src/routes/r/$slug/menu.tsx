import { CustomerMenuPage } from "@/features/ordering";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/r/$slug/menu")({
	component: Page,
});

function Page() {
	const { slug } = Route.useParams();
	const navigate = useNavigate();

	return (
		<CustomerMenuPage
			slug={slug}
			onOrderSubmitted={() => {
				// Orders go straight to the kitchen; the tab view shows the running
				// balance and the pay CTA (TAVLI-6).
				navigate({ to: "/r/$slug/orders", params: { slug } });
			}}
		/>
	);
}
