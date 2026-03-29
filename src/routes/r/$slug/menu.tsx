import { MenuBrowser, useCart, useSessionStore } from "@/features/ordering";
import type { SelectedOption } from "@/features/ordering/types";
import { LoadingState } from "@/global/components";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { Id } from "convex/_generated/dataModel";
import { useState } from "react";

export const Route = createFileRoute("/r/$slug/menu")({
	component: CustomerMenuPage,
});

function CustomerMenuPage() {
	const { slug } = Route.useParams();
	const navigate = useNavigate();
	const { sessionId, restaurantId } = useSessionStore();
	const { createDraft, addItem, submitOrder } = useCart();
	const [isSubmitting, setIsSubmitting] = useState(false);

	if (!restaurantId || !sessionId) {
		return (
			<div className="p-4">
				<LoadingState />
			</div>
		);
	}

	const handleSubmitOrder = async (data: {
		items: Array<{
			menuItemId: Id<"menuItems">;
			quantity: number;
			selectedOptions: SelectedOption[];
		}>;
		specialInstructions?: string;
		tableId: Id<"tables">;
	}) => {
		setIsSubmitting(true);
		try {
			const orderId = (await createDraft({ sessionId, tableId: data.tableId })) as Id<"orders">;
			for (const item of data.items) {
				await addItem({ orderId, ...item });
			}
			await submitOrder({
				orderId,
				specialInstructions: data.specialInstructions,
			});
			navigate({
				to: "/r/$slug/order/$orderId",
				params: { slug, orderId },
			});
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<MenuBrowser
			restaurantId={restaurantId}
			onSubmitOrder={handleSubmitOrder}
			isSubmitting={isSubmitting}
		/>
	);
}
