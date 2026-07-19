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

/** Convex env var that must be set (truthy) to enable the dev role switcher. */
export const ENABLE_DEV_ROLE_SWITCHER_ENV = "ENABLE_DEV_ROLE_SWITCHER";

function isTruthyEnv(value: string | undefined): boolean {
	if (!value) return false;
	const normalized = value.toLowerCase().trim();
	return normalized === "true" || normalized === "1" || normalized === "yes";
}

/**
 * Whether the dev-only role switcher is enabled. Requires both development
 * `CONVEX_ENV` and an explicit `ENABLE_DEV_ROLE_SWITCHER` flag so a mis-set
 * env alone cannot expose privilege escalation in non-dev deployments.
 */
export function isDevRoleSwitcherEnabled(): boolean {
	return isDevEnv() && isTruthyEnv(process.env[ENABLE_DEV_ROLE_SWITCHER_ENV]);
}

/** Convex env var that must be set (truthy) to arm the first-admin bootstrap. */
export const ALLOW_ADMIN_BOOTSTRAP_ENV = "ALLOW_ADMIN_BOOTSTRAP";

/**
 * Whether the guarded first-admin bootstrap (`admin.bootstrapFirstAdmin`) is
 * armed. Requires an explicit `ALLOW_ADMIN_BOOTSTRAP` opt-in so the mutation is
 * inert by default in every environment.
 *
 * Unlike the dev role switcher this is deliberately NOT gated on `CONVEX_ENV`:
 * seeding the very first owner/admin is a legitimate production operation. The
 * "first-admin only" and "user must already exist" guards live in
 * `decideAdminBootstrap`; this flag is the operator's arm/disarm switch, meant
 * to be set immediately before the run and unset immediately after.
 */
export function isAdminBootstrapEnabled(): boolean {
	return isTruthyEnv(process.env[ALLOW_ADMIN_BOOTSTRAP_ENV]);
}
