import { useConvexMutate } from "@/global/hooks";
import { api } from "convex/_generated/api";

export function useCart() {
	const createDraft = useConvexMutate(api.orders.createDraft);
	const addItem = useConvexMutate(api.orders.addItem);
	const updateItem = useConvexMutate(api.orders.updateItem);
	const removeItem = useConvexMutate(api.orders.removeItem);
	const submitOrder = useConvexMutate(api.orders.submitOrder);

	return {
		createDraft: createDraft.mutateAsync,
		addItem: addItem.mutateAsync,
		updateItem: updateItem.mutateAsync,
		removeItem: removeItem.mutateAsync,
		submitOrder: submitOrder.mutateAsync,
		isSubmitting: submitOrder.isPending,
	};
}
