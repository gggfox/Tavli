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
			onProceedToCheckout={(orderId) =>
				// ADR 008 pay-at-submit: the diner pays (or commits to cash) at the
				// per-order checkout before the kitchen sees the order.
				navigate({
					to: "/r/$slug/$lang/checkout",
					params: { slug, lang },
					search: { orderId },
				})
			}
		/>
	);
}
