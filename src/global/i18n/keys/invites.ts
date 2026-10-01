/**
 * Translation keys for the public invitation page at `/invites/$token`.
 *
 * The role an invitation grants is labelled with the team page's
 * `AdminStaffKeys.TEAM_ROLE_DISPLAY_*` keys, so the invitee reads the same
 * role name the person who invited them chose.
 */
export const InvitesKeys = {
	TITLE: "invites.accept.title",
	LOADING: "invites.accept.loading",
	INVALID: "invites.accept.invalid",
	INVITED: "invites.accept.invited",
	ROLE_LABEL: "invites.accept.roleLabel",
	EMAIL_LABEL: "invites.accept.emailLabel",
	ACCEPT: "invites.accept.accept",
	ACCEPTING: "invites.accept.accepting",
	ACCEPTED: "invites.accept.accepted",
	SIGN_IN_HINT: "invites.accept.signInHint",
	SIGN_IN: "invites.accept.signIn",
	GO_TO_ADMIN: "invites.accept.goToAdmin",
} as const;

export type InvitesKey = (typeof InvitesKeys)[keyof typeof InvitesKeys];
