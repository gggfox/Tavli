import { CheckoutPage } from "@/features/ordering/components/CheckoutPage";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/r/$slug/$lang/checkout")({
	validateSearch: (search: Record<string, unknown>) => ({
		orderId: search.orderId as string,
	}),
	component: Page,
});

function Page() {
	const { slug, lang } = Route.useParams();
	const { orderId } = Route.useSearch();
	const navigate = useNavigate();

	return (
		<CheckoutPage
			orderId={orderId}
			onBackToMenu={() => navigate({ to: "/r/$slug/$lang/menu", params: { slug, lang } })}
			onOrderPlaced={(id) =>
				navigate({ to: "/r/$slug/$lang/order/$orderId", params: { slug, lang, orderId: id } })
			}
		/>
	);
}
