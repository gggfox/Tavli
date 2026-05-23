/**
 * Thin wrapper around the
 *   useMutation({ mutationFn: useConvexMutation(api.X) })
 * boilerplate that has been duplicated 9+ times across feature hooks.
 *
 * Returns the standard React Query `UseMutationResult` so callers keep
 * access to `.mutate`, `.mutateAsync`, `.isPending`, `.error`, etc.
 *
 * Named `useConvexMutate` (not `useConvexMutation`) to avoid colliding
 * with the package-level `useConvexMutation` import this hook wraps.
 */
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";

export function useConvexMutate<
	Mutation extends FunctionReference<"mutation">,
>(mutation: Mutation): UseMutationResult<FunctionReturnType<Mutation>, Error, FunctionArgs<Mutation>> {
	return useMutation({
		mutationFn: useConvexMutation(mutation) as unknown as (args: FunctionArgs<Mutation>) => Promise<FunctionReturnType<Mutation>>,
	});
}
