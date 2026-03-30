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
			lang={lang}
			onNavigateToCheckout={(orderId) =>
				navigate({
					to: "/r/$slug/$lang/checkout",
					params: { slug, lang },
					search: { orderId },
				})
			}
		/>
	);
}
