import { SessionOrdersList } from "@/features/ordering";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/r/$slug/orders")({
	component: Page,
});

function Page() {
	const { slug } = Route.useParams();
	const navigate = useNavigate();

	return (
		<SessionOrdersList
			onBackToMenu={() => navigate({ to: "/r/$slug/menu", params: { slug } })}
			onViewOrder={(orderId) =>
				navigate({
					to: "/r/$slug/order/$orderId",
					params: { slug, orderId },
				})
			}
			onResumeCheckout={(orderId) =>
				navigate({
					to: "/r/$slug/$lang/checkout",
					params: { slug, lang: "en" },
					search: { orderId },
				})
			}
		/>
	);
}
