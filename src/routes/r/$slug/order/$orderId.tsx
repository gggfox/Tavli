import { CustomerOrderPage } from "@/features/ordering";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/r/$slug/order/$orderId")({
	component: Page,
});

function Page() {
	const { slug, orderId } = Route.useParams();
	const navigate = useNavigate();

	return (
		<CustomerOrderPage
			orderId={orderId}
			onBackToMenu={() => navigate({ to: "/r/$slug/menu", params: { slug } })}
		/>
	);
}
