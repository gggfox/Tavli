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
	/** What to do about a dead link — the page offers nothing else to click but home. */
	INVALID_HINT: "invites.accept.invalidHint",
	GO_HOME: "invites.accept.goHome",
	/** Fallback when the invitation names neither an organization nor a restaurant. */
	INVITED: "invites.accept.invited",
	/** `{{restaurant}}` — the one restaurant the invitation grants. */
	INVITED_RESTAURANT: "invites.accept.invitedRestaurant",
	/** `{{restaurants}}` — a few names, already joined with `Intl.ListFormat`. */
	INVITED_RESTAURANTS: "invites.accept.invitedRestaurants",
	/** `{{total}}` restaurants of `{{organization}}` — too many to name one by one. */
	INVITED_RESTAURANT_TOTAL: "invites.accept.invitedRestaurantTotal",
	/** `{{organization}}` — an organization-level invitation with no restaurants. */
	INVITED_ORGANIZATION: "invites.accept.invitedOrganization",
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
