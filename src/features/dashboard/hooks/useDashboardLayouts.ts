/**
 * Reactive list of layouts for the active scope, plus typed CRUD mutations.
 *
 * Convex's reactive query subscription means new / renamed / deleted layouts
 * appear automatically in every open tab. Mutation helpers wrap the result
 * tuple via `unwrapResult` so callers can `await` them and catch errors.
 */
import { unwrapResult } from "@/global/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useCallback, useMemo } from "react";
import type {
	DashboardLayout,
	DashboardLayoutConfig,
	DashboardScopeKind,
} from "../types";

interface UseDashboardLayoutsArgs {
	scopeKind: DashboardScopeKind;
	restaurantId: Id<"restaurants"> | null;
	enabled: boolean;
}

export function useDashboardLayouts({
	scopeKind,
	restaurantId,
	enabled,
}: UseDashboardLayoutsArgs) {
	const queryArgs = useMemo(
		() =>
			!enabled
				? "skip"
				: scopeKind === "restaurant" && restaurantId
					? { scopeKind: "restaurant" as const, restaurantId }
					: scopeKind === "portfolio"
						? { scopeKind: "portfolio" as const }
						: "skip",
		[enabled, scopeKind, restaurantId]
	);

	const query = useQuery({
		...convexQuery(api.dashboardLayouts.list, queryArgs),
		select: unwrapResult<DashboardLayout[]>,
	});

	const createMutation = useMutation({
		mutationFn: useConvexMutation(api.dashboardLayouts.create),
	});
	const updateMutation = useMutation({
		mutationFn: useConvexMutation(api.dashboardLayouts.update),
	});
	const removeMutation = useMutation({
		mutationFn: useConvexMutation(api.dashboardLayouts.remove),
	});
	const duplicateMutation = useMutation({
		mutationFn: useConvexMutation(api.dashboardLayouts.duplicate),
	});
	const reorderMutation = useMutation({
		mutationFn: useConvexMutation(api.dashboardLayouts.reorder),
	});

	const create = useCallback(
		async (args: { name: string; config?: DashboardLayoutConfig }) => {
			if (scopeKind === "restaurant" && !restaurantId) {
				throw new Error("missing restaurantId for restaurant-scoped create");
			}
			const result = await createMutation.mutateAsync({
				scopeKind,
				restaurantId: scopeKind === "restaurant" ? restaurantId ?? undefined : undefined,
				name: args.name,
				config: args.config,
			});
			return unwrapResult(result) as Id<"dashboardLayouts">;
		},
		[createMutation, scopeKind, restaurantId]
	);

	const update = useCallback(
		async (args: {
			layoutId: Id<"dashboardLayouts">;
			name?: string;
			config?: DashboardLayoutConfig;
			position?: number;
		}) => {
			const result = await updateMutation.mutateAsync(args);
			return unwrapResult(result);
		},
		[updateMutation]
	);

	const remove = useCallback(
		async (layoutId: Id<"dashboardLayouts">) => {
			const result = await removeMutation.mutateAsync({ layoutId });
			return unwrapResult(result);
		},
		[removeMutation]
	);

	const duplicate = useCallback(
		async (args: {
			layoutId: Id<"dashboardLayouts">;
			name?: string;
		}) => {
			const result = await duplicateMutation.mutateAsync(args);
			return unwrapResult(result) as Id<"dashboardLayouts">;
		},
		[duplicateMutation]
	);

	const reorder = useCallback(
		async (orderedIds: Id<"dashboardLayouts">[]) => {
			if (scopeKind === "restaurant" && !restaurantId) return;
			const result = await reorderMutation.mutateAsync({
				scopeKind,
				restaurantId: scopeKind === "restaurant" ? restaurantId ?? undefined : undefined,
				orderedIds,
			});
			return unwrapResult(result);
		},
		[reorderMutation, scopeKind, restaurantId]
	);

	return {
		layouts: query.data ?? [],
		isLoading: query.isLoading,
		error: query.error,
		create,
		update,
		remove,
		duplicate,
		reorder,
	};
}
