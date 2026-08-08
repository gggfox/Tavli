import { Cart, useCart } from "@/features/ordering";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";

export const Route = createFileRoute("/r/$slug/$lang/cart")({
	validateSearch: (search: Record<string, unknown>) => ({
		orderId: search.orderId as string,
	}),
	component: CartPage,
});

function CartPage() {
	const { slug, lang } = Route.useParams();
	const { orderId } = Route.useSearch();
	const navigate = useNavigate();
	const { removeItem } = useCart();

	const handleSubmit = () => {
		// ADR 008 pay-at-submit: the draft heads to the per-order checkout,
		// where payment (or a cash commitment) releases it to the kitchen.
		navigate({
			to: "/r/$slug/$lang/checkout",
			params: { slug, lang },
			search: { orderId },
		});
	};

	return (
		<Cart
			orderId={orderId as Id<"orders">}
			onBack={() => navigate({ to: "/r/$slug/$lang/menu", params: { slug, lang } })}
			onSubmit={handleSubmit}
			onRemoveItem={(orderItemId) => removeItem({ orderItemId })}
			isSubmitting={false}
		/>
	);
}
