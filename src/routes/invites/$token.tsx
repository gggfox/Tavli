import { unwrapResult } from "@/global/utils/unwrapResult";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { SignInButton, useAuth } from "@clerk/tanstack-react-start";
import { api } from "convex/_generated/api";
import { INVITATION_STATUS } from "convex/constants";
import type { ReactNode } from "react";
import { useState } from "react";

export const Route = createFileRoute("/invites/$token")({
	component: InviteAcceptPage,
});

function InviteAcceptPage() {
	const { token } = Route.useParams();
	const { isSignedIn } = useAuth();
	const preview = useQuery({
		...convexQuery(api.invites.getByTokenPublic, { token }),
	});

	const accept = useMutation({ mutationFn: useConvexMutation(api.invites.acceptInvitation) });
	const [accepted, setAccepted] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const onAccept = async () => {
		try {
			unwrapResult(await accept.mutateAsync({ token }));
			setAccepted(true);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not accept invitation");
		}
	};

	const row = preview.data;
	const expired = row ? row.expiresAt < Date.now() : false;
	const invalid =
		!row ||
		row.status !== INVITATION_STATUS.PENDING ||
		expired;

	let inviteActions: ReactNode = null;
	if (isSignedIn) {
		if (accepted) {
			inviteActions = (
				<p className="text-sm text-green-600 dark:text-green-400">
					You&apos;re in! Open the admin app to get started.
				</p>
			);
		} else {
			inviteActions = (
				<>
					<button
						type="button"
						disabled={invalid || accept.isPending}
						onClick={() => void onAccept()}
						className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
					>
						{accept.isPending ? "Accepting…" : "Accept invitation"}
					</button>
					{error && <p className="text-sm text-destructive">{error}</p>}
				</>
			);
		}
	} else {
		inviteActions = (
			<>
				<p className="text-sm text-faint-foreground">Sign in with the invited email to continue.</p>
				<SignInButton mode="modal">
					<button
						type="button"
						className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
					>
						Sign in
					</button>
				</SignInButton>
			</>
		);
	}

	return (
		<div className="min-h-[60vh] flex flex-col items-center justify-center p-6">
			<div className="max-w-md w-full rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
				<h1 className="text-xl font-semibold text-foreground">Team invitation</h1>
				{preview.isLoading && <p className="text-sm text-faint-foreground">Loading…</p>}
				{!preview.isLoading && invalid && (
					<p className="text-sm text-destructive">
						This invitation link is not valid or has expired.
					</p>
				)}
				{row && !invalid && (
					<div className="text-sm space-y-1 text-muted-foreground">
						<p>
							<span className="text-foreground font-medium">Role:</span> {row.role}
						</p>
						<p>
							<span className="text-foreground font-medium">Email:</span> {row.email}
						</p>
					</div>
				)}

				{inviteActions}

				<Link to="/admin" className="block text-center text-xs text-primary hover:underline">
					Go to admin
				</Link>
			</div>
		</div>
	);
}
