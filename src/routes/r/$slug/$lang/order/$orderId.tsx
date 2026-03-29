import { CustomerOrderPage } from "@/features/ordering";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/r/$slug/$lang/order/$orderId")({
	component: Page,
});

function Page() {
	const { slug, lang, orderId } = Route.useParams();
	const navigate = useNavigate();

	return (
		<CustomerOrderPage
			orderId={orderId}
			onBackToMenu={() => navigate({ to: "/r/$slug/$lang/menu", params: { slug, lang } })}
		/>
	);
}
