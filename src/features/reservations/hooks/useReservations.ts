import { unwrapResult, type UnwrappedValue } from "@/global/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "convex/_generated/dataModel";
import { useMemo } from "react";
import type { ReservationStatus } from "@/features/reservations/statusConfig";
import {
	dashboardReservationBounds,
	type ReservationRange,
} from "@/features/reservations/utils";

type ReservationsValue = UnwrappedValue<FunctionReturnType<typeof api.reservations.listForRange>>;

/**
 * Reservations for one or more restaurants filtered by named date range.
 * Uses `listForRange` when exactly one id is passed; otherwise
 * `listForRangeMulti`. Optional `statuses` is applied on the server so the
 * client does not load unneeded rows (keeps the table responsive).
 * Exposes the standard mutation surface (confirm, cancel, mark seated, mark completed).
 */
export function useReservations(
	restaurantIds: readonly Id<"restaurants">[] | undefined,
	range: ReservationRange,
	customDay: string | undefined,
	statuses?: readonly ReservationStatus[] | undefined
) {
	const bounds = useMemo(
		() => dashboardReservationBounds(range, customDay),
		[range, customDay]
	);

	const statusesSerialized =
		statuses && statuses.length > 0
			? [...statuses].sort((a, b) => a.localeCompare(b)).join(",")
			: "";
	const statusesForApi = useMemo((): ReservationStatus[] | undefined => {
		if (!statusesSerialized) return undefined;
		return statusesSerialized.split(",") as ReservationStatus[];
	}, [statusesSerialized]);

	const singleId = restaurantIds?.length === 1 ? restaurantIds[0] : undefined;
	const multiIdsSorted = useMemo((): Id<"restaurants">[] | undefined => {
		if (!restaurantIds || restaurantIds.length <= 1) return undefined;
		return [...restaurantIds].sort((a, b) => a.localeCompare(b));
	}, [restaurantIds]);

	const singleQueryArgs = useMemo(() => {
		if (!singleId) return "skip" as const;
		return {
			restaurantId: singleId,
			fromMs: bounds.fromMs,
			toMs: bounds.toMs,
			...(statusesForApi ? { statuses: statusesForApi } : {}),
		};
	}, [singleId, bounds.fromMs, bounds.toMs, statusesForApi]);

	const multiQueryArgs = useMemo(() => {
		if (!multiIdsSorted?.length) return "skip" as const;
		return {
			restaurantIds: multiIdsSorted,
			fromMs: bounds.fromMs,
			toMs: bounds.toMs,
			...(statusesForApi ? { statuses: statusesForApi } : {}),
		};
	}, [multiIdsSorted, bounds.fromMs, bounds.toMs, statusesForApi]);

	const singleQuery = useQuery({
		...convexQuery(api.reservations.listForRange, singleQueryArgs),
		enabled: Boolean(singleId),
		select: unwrapResult<ReservationsValue>,
	});

	const multiQuery = useQuery({
		...convexQuery(api.reservations.listForRangeMulti, multiQueryArgs),
		enabled: Boolean(multiIdsSorted?.length),
		select: unwrapResult<ReservationsValue>,
	});

	const reservations = multiIdsSorted ? multiQuery.data : singleQuery.data;
	const isLoading = multiIdsSorted ? multiQuery.isLoading : singleQuery.isLoading;
	const error = multiIdsSorted ? multiQuery.error : singleQuery.error;

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
