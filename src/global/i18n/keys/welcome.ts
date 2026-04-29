/**
 * Translation keys for the public homepage / welcome section shown to
 * unauthenticated visitors.
 */
export const WelcomeKeys = {
	BADGE: "welcome.badge",
	HEADING_PREFIX: "welcome.headingPrefix",
	SUBHEADING: "welcome.subheading",
	FEATURE_MENU_TITLE: "welcome.feature.menuTitle",
	FEATURE_MENU_DESC: "welcome.feature.menuDesc",
	FEATURE_TABLE_TITLE: "welcome.feature.tableTitle",
	FEATURE_TABLE_DESC: "welcome.feature.tableDesc",
	FEATURE_AUTH_TITLE: "welcome.feature.authTitle",
	FEATURE_AUTH_DESC: "welcome.feature.authDesc",
	GET_STARTED: "welcome.getStarted",
} as const;

export type WelcomeKey = (typeof WelcomeKeys)[keyof typeof WelcomeKeys];
