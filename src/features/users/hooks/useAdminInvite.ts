/**
 * The single-invite call, reduced to three outcomes the form can render.
 *
 * `createAdminInvitation` is also the classifier: there is no public "would this
 * be safe?" query, so a `cross_org` or `duplicate_pending` verdict comes back as
 * a *rejection* carrying a stable code. This hook turns that rejection into
 * `needs_acknowledgement` — a first-class outcome, not an error — so the form
 * can show the warning and the checkbox that unlocks a re-send, and keeps
 * genuine failures (`error`) separate from it.
 */
import { extractErrorCode } from "@/global/utils";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { InviteOverride, InviteRole } from "convex/inviteOnboardingHelpers";
import { useCallback } from "react";
import type { BackendErrorCode } from "@/global/i18n";
import { overrideForErrorCode } from "../utils/inviteVerdicts";

export interface AdminInviteInput {
	readonly email: string;
	readonly role: InviteRole;
	readonly organizationId: Id<"organizations">;
	readonly restaurantIds: Id<"restaurants">[];
	readonly firstName?: string;
	readonly paternalLastname?: string;
	readonly maternalLastname?: string;
	readonly acknowledgeOrgMove?: boolean;
	readonly replaceExistingPending?: boolean;
}

export type AdminInviteOutcome =
	| { kind: "sent"; status: string; replacedPendingCount: number }
	| { kind: "needs_acknowledgement"; override: InviteOverride; code: BackendErrorCode }
	| { kind: "error"; code: BackendErrorCode | null };

export interface UseAdminInviteResult {
	readonly send: (input: AdminInviteInput) => Promise<AdminInviteOutcome>;
	readonly isSending: boolean;
}

export function useAdminInvite(): UseAdminInviteResult {
	const { mutateAsync, isPending } = useMutation({
		mutationFn: useConvexMutation(api.inviteOnboarding.createAdminInvitation),
	});

	const send = useCallback(
		async (input: AdminInviteInput): Promise<AdminInviteOutcome> => {
			try {
				const [value, error] = await mutateAsync(input);
				if (error) return classify(error);
				return {
					kind: "sent",
					status: value.status,
					replacedPendingCount: value.replacedPendingCount,
				};
			} catch (thrown) {
				// A throw is a transport/auth failure rather than a verdict, but it
				// can still carry a stable code — classify it the same way.
				return classify(thrown);
			}
		},
		[mutateAsync]
	);

	return { send, isSending: isPending };
}

function classify(error: unknown): AdminInviteOutcome {
	const code = extractErrorCode(error);
	const override = overrideForErrorCode(code);
	if (override && code) return { kind: "needs_acknowledgement", override, code };
	return { kind: "error", code };
}
