/**
 * Translation keys for the public-facing customer experience at /r/$slug.
 */
export const CustomerKeys = {
	MENU: "customer.nav.menu",
	RESERVE: "customer.nav.reserve",
	SIGN_IN: "customer.auth.signIn",
	SIGN_UP: "customer.auth.signUp",
	INFO_HEADING: "customer.info.heading",
	INFO_HOURS_LABEL: "customer.info.hoursLabel",
	INFO_HOURS_VALUE: "customer.info.hoursValue",
	INFO_ADDRESS_LABEL: "customer.info.addressLabel",
	INFO_DIRECTIONS: "customer.info.directions",
	INFO_EMAIL_LABEL: "customer.info.emailLabel",
	INFO_PHONE_LABEL: "customer.info.phoneLabel",
	INFO_WHATSAPP_LABEL: "customer.info.whatsappLabel",
	/** "{{platform}} (opens in a new tab)" — accessible name for each icon link. */
	INFO_SOCIAL_ARIA: "customer.info.socialAria",
	SOCIAL_INSTAGRAM: "customer.social.instagram",
	SOCIAL_FACEBOOK: "customer.social.facebook",
	SOCIAL_TIKTOK: "customer.social.tiktok",
	SOCIAL_X: "customer.social.x",
	SOCIAL_YOUTUBE: "customer.social.youtube",
} as const;

export type CustomerKey = (typeof CustomerKeys)[keyof typeof CustomerKeys];
