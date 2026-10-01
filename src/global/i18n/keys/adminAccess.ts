/**
 * Translation keys for the gates in front of the staff app: the `/admin` and
 * `/dashboard` access check, the auth placeholder states in `features/auth`,
 * and the "no restaurant yet" line the restaurant-scoped admin pages share.
 */
export const AdminAccessKeys = {
	/** Signed in, but holds no staff role. */
	ACCESS_DENIED_TITLE: "adminAccess.denied.title",
	ACCESS_DENIED_DESCRIPTION: "adminAccess.denied.description",
	/** Signed out: the page offers a way in instead of a dead end. */
	SIGN_IN_TITLE: "adminAccess.signIn.title",
	SIGN_IN_DESCRIPTION: "adminAccess.signIn.description",
	SIGN_IN_BUTTON: "adminAccess.signIn.button",
	/** Orders, payments and reservations before the restaurant exists. */
	SETUP_RESTAURANT_FIRST: "adminAccess.setupRestaurantFirst",
	ADMIN_HOME_TITLE: "adminAccess.home.title",
	ADMIN_HOME_DESCRIPTION: "adminAccess.home.description",
	AUTH_LOADING: "adminAccess.auth.loading",
	AUTH_REQUIRED_TITLE: "adminAccess.auth.requiredTitle",
	AUTH_REQUIRED_MESSAGE: "adminAccess.auth.requiredMessage",
	INSUFFICIENT_TITLE: "adminAccess.auth.insufficientTitle",
	INSUFFICIENT_DESCRIPTION: "adminAccess.auth.insufficientDescription",
} as const;

export type AdminAccessKey = (typeof AdminAccessKeys)[keyof typeof AdminAccessKeys];
