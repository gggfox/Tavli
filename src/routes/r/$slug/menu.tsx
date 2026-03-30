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
			onNavigateToCheckout={(orderId) =>
				navigate({
					to: "/r/$slug/$lang/checkout",
					params: { slug, lang: "en" },
					search: { orderId },
				})
			}
		/>
	);
}
