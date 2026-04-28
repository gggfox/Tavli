import { SessionOrdersList } from "@/features/ordering";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/r/$slug/$lang/orders")({
	component: Page,
});

function Page() {
	const { slug, lang } = Route.useParams();
	const navigate = useNavigate();

	return (
		<SessionOrdersList
			onBackToMenu={() => navigate({ to: "/r/$slug/$lang/menu", params: { slug, lang } })}
			onViewOrder={(orderId) =>
				navigate({
					to: "/r/$slug/$lang/order/$orderId",
					params: { slug, lang, orderId },
				})
			}
			onResumeCheckout={(orderId) =>
				navigate({
					to: "/r/$slug/$lang/checkout",
					params: { slug, lang },
					search: { orderId },
				})
			}
		/>
	);
}
