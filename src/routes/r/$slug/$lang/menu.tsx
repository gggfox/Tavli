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
			onNavigateToOrder={(orderId) =>
				navigate({ to: "/r/$slug/$lang/order/$orderId", params: { slug, lang, orderId } })
			}
		/>
	);
}
