import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { api } from "convex/_generated/api";

export function useCart() {
	const createDraft = useMutation({ mutationFn: useConvexMutation(api.orders.createDraft) });
	const addItem = useMutation({ mutationFn: useConvexMutation(api.orders.addItem) });
	const updateItem = useMutation({ mutationFn: useConvexMutation(api.orders.updateItem) });
	const removeItem = useMutation({ mutationFn: useConvexMutation(api.orders.removeItem) });
	const submitOrder = useMutation({ mutationFn: useConvexMutation(api.orders.submitOrder) });

	return {
		createDraft: createDraft.mutateAsync,
		addItem: addItem.mutateAsync,
		updateItem: updateItem.mutateAsync,
		removeItem: removeItem.mutateAsync,
		submitOrder: submitOrder.mutateAsync,
		isSubmitting: submitOrder.isPending,
	};
}
