import { AdminStaffKeys, ErrorKeys, i18n, InvitesKeys } from "@/global/i18n";
import { getErrorMessage } from "@/global/utils/errorMessages";
import { unwrapResult } from "@/global/utils/unwrapResult";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { SignInButton, useAuth } from "@clerk/tanstack-react-start";
import { api } from "convex/_generated/api";
import { RESTAURANT_MEMBER_ROLE, USER_ROLES } from "convex/constants";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/invites/$token")({
	head: () => ({
		meta: [{ name: "referrer", content: "no-referrer" }],
	}),
	component: InviteAcceptPage,
});

type InviteRole =
	| typeof USER_ROLES.OWNER
	| typeof RESTAURANT_MEMBER_ROLE.MANAGER
	| typeof RESTAURANT_MEMBER_ROLE.EMPLOYEE;

/**
 * The role an invitation grants, in the words the team page used when the
 * invitation was sent — the invitee should read the same role name the person
 * who invited them chose, not the stored enum.
 */
const INVITE_ROLE_LABEL_KEY: Record<InviteRole, string> = {
	[USER_ROLES.OWNER]: AdminStaffKeys.TEAM_ROLE_DISPLAY_OWNER,
	[RESTAURANT_MEMBER_ROLE.MANAGER]: AdminStaffKeys.TEAM_ROLE_DISPLAY_MANAGER,
	[RESTAURANT_MEMBER_ROLE.EMPLOYEE]: AdminStaffKeys.TEAM_ROLE_DISPLAY_EMPLOYEE,
};

/** Up to this many restaurants are named one by one; past it the line counts them. */
const MAX_NAMED_RESTAURANTS = 3;

/**
 * Who is inviting, in one sentence: the one restaurant by name, a few joined
 * the way the reader's language joins a list ("A, B y C"), many as "N
 * restaurants of {organization}", and an organization-level invitation by the
 * organization's name. Falls back to the anonymous "join a team" line only when
 * the invitation names nothing (e.g. its organization is gone).
 */
export function inviteHeadline(
	invite: { organizationName: string | null; restaurantNames: string[] },
	t: TFunction,
	locale: string
): string {
	const { organizationName, restaurantNames } = invite;
	if (restaurantNames.length === 1) {
		return t(InvitesKeys.INVITED_RESTAURANT, { restaurant: restaurantNames[0] });
	}
	if (restaurantNames.length > MAX_NAMED_RESTAURANTS && organizationName) {
		return t(InvitesKeys.INVITED_RESTAURANT_TOTAL, {
			total: restaurantNames.length,
			organization: organizationName,
		});
	}
	if (restaurantNames.length > 1) {
		const restaurants = new Intl.ListFormat(locale, { type: "conjunction" }).format(
			restaurantNames
		);
		return t(InvitesKeys.INVITED_RESTAURANTS, { restaurants });
	}
	if (organizationName) {
		return t(InvitesKeys.INVITED_ORGANIZATION, { organization: organizationName });
	}
	return t(InvitesKeys.INVITED);
}

function InviteAcceptPage() {
	const { t, i18n: activeI18n } = useTranslation();
	const { token } = Route.useParams();
	const { isSignedIn } = useAuth();
	const [now] = useState(() => Date.now());
	const preview = useQuery({
		...convexQuery(api.invites.getByTokenPublic, { token, now }),
	});

	const accept = useMutation({ mutationFn: useConvexMutation(api.invites.acceptInvitation) });
	const [accepted, setAccepted] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const onAccept = async () => {
		try {
			unwrapResult(await accept.mutateAsync({ token }));
			setAccepted(true);
		} catch (e) {
			setError(getErrorMessage(e, i18n.t.bind(i18n), ErrorKeys.GENERIC));
		}
	};

	const row = preview.data;
	const invalid = !row;
	// Accepting flips the invitation out of "pending", so the preview goes null
	// right after a successful accept — that is not a dead link.
	const dead = !preview.isLoading && invalid && !accepted;

	if (dead) {
		return (
			<div className="min-h-[60vh] flex flex-col items-center justify-center p-6">
				<div className="max-w-md w-full rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
					<h1 className="text-xl font-semibold text-foreground">{t(InvitesKeys.TITLE)}</h1>
					<p className="text-sm text-destructive">{t(InvitesKeys.INVALID)}</p>
					<p className="text-sm text-muted-foreground">{t(InvitesKeys.INVALID_HINT)}</p>
					<Link to="/" className="block text-center text-sm text-primary hover:underline">
						{t(InvitesKeys.GO_HOME)}
					</Link>
				</div>
			</div>
		);
	}

	let inviteActions: ReactNode = null;
	if (isSignedIn) {
		if (accepted) {
			inviteActions = (
				<p className="text-sm text-green-600 dark:text-green-400">{t(InvitesKeys.ACCEPTED)}</p>
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
						{accept.isPending ? t(InvitesKeys.ACCEPTING) : t(InvitesKeys.ACCEPT)}
					</button>
					{error && <p className="text-sm text-destructive">{error}</p>}
				</>
			);
		}
	} else {
		inviteActions = (
			<>
				<p className="text-sm text-faint-foreground">{t(InvitesKeys.SIGN_IN_HINT)}</p>
				<SignInButton mode="modal">
					<button
						type="button"
						className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
					>
						{t(InvitesKeys.SIGN_IN)}
					</button>
				</SignInButton>
			</>
		);
	}

	return (
		<div className="min-h-[60vh] flex flex-col items-center justify-center p-6">
			<div className="max-w-md w-full rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
				<h1 className="text-xl font-semibold text-foreground">{t(InvitesKeys.TITLE)}</h1>
				{preview.isLoading && (
					<p className="text-sm text-faint-foreground">{t(InvitesKeys.LOADING)}</p>
				)}
				{row && (
					<p className="text-sm text-muted-foreground">
						{inviteHeadline(row, t, activeI18n.language)}
					</p>
				)}
				{row && !invalid && isSignedIn && (
					<div className="text-sm space-y-1 text-muted-foreground">
						<p>
							<span className="text-foreground font-medium">{t(InvitesKeys.ROLE_LABEL)}:</span>{" "}
							{t(INVITE_ROLE_LABEL_KEY[row.role])}
						</p>
						<p>
							<span className="text-foreground font-medium">{t(InvitesKeys.EMAIL_LABEL)}:</span>{" "}
							{row.email}
						</p>
					</div>
				)}

				{inviteActions}

				<Link to="/admin" className="block text-center text-xs text-primary hover:underline">
					{t(InvitesKeys.GO_TO_ADMIN)}
				</Link>
			</div>
		</div>
	);
}
