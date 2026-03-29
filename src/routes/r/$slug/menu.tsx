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
			onNavigateToOrder={(orderId) =>
				navigate({ to: "/r/$slug/order/$orderId", params: { slug, orderId } })
			}
		/>
	);
}
