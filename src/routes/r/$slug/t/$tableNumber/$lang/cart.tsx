import { Cart, useCart } from "@/features/ordering";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";

export const Route = createFileRoute("/r/$slug/t/$tableNumber/$lang/cart")({
	validateSearch: (search: Record<string, unknown>) => ({
		orderId: search.orderId as string,
	}),
	component: CartPage,
});

function CartPage() {
	const { slug, tableNumber, lang } = Route.useParams();
	const { orderId } = Route.useSearch();
	const navigate = useNavigate();
	const { removeItem, submitOrder, isSubmitting } = useCart();

	const handleSubmit = async () => {
		await submitOrder({ orderId: orderId as Id<"orders"> });
		navigate({
			to: "/r/$slug/t/$tableNumber/$lang/order/$orderId",
			params: { slug, tableNumber, lang, orderId },
		});
	};

	return (
		<Cart
			orderId={orderId as Id<"orders">}
			onBack={() =>
				navigate({ to: "/r/$slug/t/$tableNumber/$lang/menu", params: { slug, tableNumber, lang } })
			}
			onSubmit={handleSubmit}
			onRemoveItem={(orderItemId) => removeItem({ orderItemId })}
			isSubmitting={isSubmitting}
		/>
	);
}
