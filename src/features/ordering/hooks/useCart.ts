import { useConvexMutate } from "@/global/hooks";
import { api } from "convex/_generated/api";

/**
 * Draft-cart mutations (ADR 008). There is deliberately no `submitOrder`
 * here: pay-at-submit orders reach the kitchen through the checkout
 * (`stripe.createPaymentIntent` → webhook, or `orders.requestPayInPerson`),
 * never through the legacy `orders.submitOrder`.
 */
export function useCart() {
	const createDraft = useConvexMutate(api.orders.createDraft);
	const addItem = useConvexMutate(api.orders.addItem);
	const updateItem = useConvexMutate(api.orders.updateItem);
	const removeItem = useConvexMutate(api.orders.removeItem);
	const setDraftInstructions = useConvexMutate(api.orders.setDraftInstructions);

	return {
		createDraft: createDraft.mutateAsync,
		addItem: addItem.mutateAsync,
		updateItem: updateItem.mutateAsync,
		removeItem: removeItem.mutateAsync,
		setDraftInstructions: setDraftInstructions.mutateAsync,
	};
}
