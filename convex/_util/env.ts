/**
 * Backend environment helpers.
 *
 * Convex backend functions read environment variables from the deployment
 * (configured per-deployment in the Convex Dashboard or via `npx convex env set`).
 * `CONVEX_ENV` is a custom variable we use to gate dev-only behavior such as
 * the role-switcher in the Settings modal.
 *
 * The default is "production" so that any deployment that forgets to set
 * `CONVEX_ENV` is locked down rather than exposed.
 */

export const CONVEX_ENV = {
	DEVELOPMENT: "development",
	STAGING: "staging",
	PRODUCTION: "production",
} as const;

export type ConvexEnv = (typeof CONVEX_ENV)[keyof typeof CONVEX_ENV];

/**
 * Read the current Convex deployment environment from `process.env.CONVEX_ENV`.
 * Accepts common aliases (`dev`, `prod`, `stage`). Falls back to "production"
 * when unset or unrecognized.
 */
export function getConvexEnv(): ConvexEnv {
	const raw = process.env.CONVEX_ENV?.toLowerCase().trim();

	if (raw === CONVEX_ENV.DEVELOPMENT || raw === "dev") {
		return CONVEX_ENV.DEVELOPMENT;
	}
	if (raw === CONVEX_ENV.STAGING || raw === "stage") {
		return CONVEX_ENV.STAGING;
	}
	return CONVEX_ENV.PRODUCTION;
}

/**
 * Whether the deployment is running in development mode.
 * Used to gate developer-only operations such as the role switcher.
 */
export function isDevEnv(): boolean {
	return getConvexEnv() === CONVEX_ENV.DEVELOPMENT;
}
