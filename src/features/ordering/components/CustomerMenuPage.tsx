import { LoadingState } from "@/global/components";
import type { Id } from "convex/_generated/dataModel";
import { useState } from "react";
import { useCart } from "../hooks/useCart";
import { useSessionStore } from "../hooks/useSession";
import type { SelectedOption } from "../types";
import { MenuBrowser } from "./MenuBrowser";

interface CustomerMenuPageProps {
	lang?: string;
	onNavigateToCheckout: (orderId: string) => void;
}

export function CustomerMenuPage({ lang, onNavigateToCheckout }: Readonly<CustomerMenuPageProps>) {
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
				await addItem({ orderId, ...item, ...(lang ? { lang } : {}) });
			}
			await submitOrder({
				orderId,
				specialInstructions: data.specialInstructions,
			});
			onNavigateToCheckout(orderId);
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<MenuBrowser
			restaurantId={restaurantId}
			{...(lang ? { lang } : {})}
			onSubmitOrder={handleSubmitOrder}
			isSubmitting={isSubmitting}
		/>
	);
}
