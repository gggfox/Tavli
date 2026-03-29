import { OrderStatus } from "@/features/ordering";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";

export const Route = createFileRoute("/r/$slug/order/$orderId")({
	component: OrderStatusPage,
});

function OrderStatusPage() {
	const { slug, orderId } = Route.useParams();
	const navigate = useNavigate();

	return (
		<OrderStatus
			orderId={orderId as Id<"orders">}
			onBackToMenu={() => navigate({ to: "/r/$slug/menu", params: { slug } })}
		/>
	);
}
