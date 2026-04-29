/**
 * Translation keys for the public-facing customer experience at /r/$slug.
 */
export const CustomerKeys = {
	MENU: "customer.nav.menu",
	RESERVE: "customer.nav.reserve",
	SIGN_UP: "customer.auth.signUp",
} as const;

export type CustomerKey = (typeof CustomerKeys)[keyof typeof CustomerKeys];
