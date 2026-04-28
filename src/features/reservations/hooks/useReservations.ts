import { unwrapQuery, unwrapResult } from "@/global/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useMemo } from "react";
import { rangeBounds, type ReservationRange } from "../utils";

/**
 * Reservations for a restaurant filtered by named date range. Wraps the
 * Convex `listForRange` query and exposes the standard mutation surface
 * (confirm, cancel, mark seated, mark completed).
 */
export function useReservations(
	restaurantId: Id<"restaurants"> | undefined,
	range: ReservationRange
) {
	const bounds = useMemo(() => rangeBounds(range), [range]);

	const { data: rawResult, isLoading } = useQuery({
		...convexQuery(
			api.reservations.listForRange,
			restaurantId
				? {
						restaurantId,
						fromMs: bounds.fromMs,
						toMs: bounds.toMs,
					}
				: "skip"
		),
		enabled: Boolean(restaurantId),
	});
	const { data: reservations, error } = unwrapQuery(rawResult);

	const confirmMutation = useMutation({
		mutationFn: useConvexMutation(api.reservations.confirm),
	});
	const cancelMutation = useMutation({
		mutationFn: useConvexMutation(api.reservations.cancel),
	});
	const markSeatedMutation = useMutation({
		mutationFn: useConvexMutation(api.reservations.markSeated),
	});
	const markCompletedMutation = useMutation({
		mutationFn: useConvexMutation(api.reservations.markCompleted),
	});

	return {
		reservations: reservations ?? [],
		isLoading,
		error,
		confirm: async (
			args: Parameters<typeof confirmMutation.mutateAsync>[0]
		) => unwrapResult(await confirmMutation.mutateAsync(args)),
		cancel: async (args: Parameters<typeof cancelMutation.mutateAsync>[0]) =>
			unwrapResult(await cancelMutation.mutateAsync(args)),
		markSeated: async (
			args: Parameters<typeof markSeatedMutation.mutateAsync>[0]
		) => unwrapResult(await markSeatedMutation.mutateAsync(args)),
		markCompleted: async (
			args: Parameters<typeof markCompletedMutation.mutateAsync>[0]
		) => unwrapResult(await markCompletedMutation.mutateAsync(args)),
	};
}
