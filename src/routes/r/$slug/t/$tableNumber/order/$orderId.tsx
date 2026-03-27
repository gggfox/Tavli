import { OrderStatus } from "@/features/ordering";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";

export const Route = createFileRoute("/r/$slug/t/$tableNumber/order/$orderId")({
	component: OrderStatusPage,
});

function OrderStatusPage() {
	const { slug, tableNumber, orderId } = Route.useParams();
	const navigate = useNavigate();

	return (
		<OrderStatus
			orderId={orderId as Id<"orders">}
			onBackToMenu={() =>
				navigate({ to: "/r/$slug/t/$tableNumber/menu", params: { slug, tableNumber } })
			}
		/>
	);
}
