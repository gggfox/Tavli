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

import { AppUrlNotConfiguredError, ConflictError } from "../_shared/errors";

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

/** Fallback app base URL used only when `CONVEX_ENV` is development. */
export const DEV_APP_URL = "http://localhost:3000";

/**
 * Resolve the public app base URL used to build user-facing links from the
 * backend (e.g. the accept link inside invite emails). Reads
 * `PUBLIC_APP_URL`, falling back to `VITE_APP_URL`; blank values count as
 * unset. Trailing slashes are stripped so callers can safely append paths.
 *
 * In development a missing URL falls back to `http://localhost:3000`. In
 * staging and production a missing URL throws `AppUrlNotConfiguredError`
 * (stable code `APP_URL_NOT_CONFIGURED`) — failing loud beats silently
 * emailing real users a dead localhost link.
 */
export function getAppUrl(): string {
	const configured = (process.env.PUBLIC_APP_URL ?? process.env.VITE_APP_URL)?.trim();
	if (configured) {
		return configured.replace(/\/+$/, "");
	}
	if (isDevEnv()) {
		return DEV_APP_URL;
	}
	throw new AppUrlNotConfiguredError(
		`PUBLIC_APP_URL (or VITE_APP_URL) must be set when CONVEX_ENV is "${getConvexEnv()}"; refusing to fall back to localhost.`
	);
}

/**
 * Convex env var holding the Stripe **Price** id for the 2,000 MXN/month
 * platform subscription (`price_…`, recurring monthly).
 *
 * Deliberately not a constant: dev and production are separate Stripe accounts
 * (see `documentation/runbooks/stripe-go-live.md`), so the id differs per
 * deployment. `PLATFORM_MONTHLY_FEE_MXN_CENTS` is display copy only — this
 * Price is what Stripe actually charges.
 */
export const STRIPE_PLATFORM_FEE_PRICE_ID_ENV = "STRIPE_PLATFORM_FEE_PRICE_ID";

/**
 * Resolve the platform-subscription Price id, or throw the stable
 * `ERROR_BILLING_PRICE_NOT_CONFIGURED` code when the deployment has none.
 *
 * Fails loud like `getAppUrl`: a missing Price cannot be defaulted, and a
 * silent fallback would either charge the wrong amount or charge against the
 * wrong Stripe account.
 */
export function getStripePlatformFeePriceId(): string {
	const configured = process.env[STRIPE_PLATFORM_FEE_PRICE_ID_ENV]?.trim();
	if (configured) return configured;
	throw new ConflictError("ERROR_BILLING_PRICE_NOT_CONFIGURED");
}

/**
 * The three Stripe webhook signing secrets, one per destination.
 *
 * They are **not** interchangeable and never share a destination: each Stripe
 * event destination mints its own secret, and a delivery signed by one fails
 * verification against another. Which handler reads which:
 *
 * | Env var                                    | Route                       | Handler                              |
 * | ------------------------------------------ | --------------------------- | ------------------------------------ |
 * | `STRIPE_WEBHOOK_SECRET`                    | `/stripe/webhook`           | `stripe.fulfillPayment`              |
 * | `STRIPE_CONNECT_WEBHOOK_SECRET`            | `/stripe/connect-webhook`   | `stripe.handleThinEvent`             |
 * | `STRIPE_CONNECTED_ACCOUNT_WEBHOOK_SECRET`  | `/stripe/connected-webhook` | `stripe.handleConnectedAccountEvent` |
 *
 * The third one (TAVLI-103) is for **v1 snapshot events on connected
 * accounts** — `payout.*`, which fire on the restaurant's own account and
 * carry `event.account`. It is a third destination rather than a widening of
 * either existing one because the second is thin-payload-only (a different
 * parser) and the first is scoped to Tavli's own account, where no payout of a
 * restaurant's ever lands.
 *
 * Names are declared here so the set is countable in one place; the secrets
 * themselves are read at call time in `convex/stripe.ts`, per deployment. See
 * `documentation/runbooks/stripe-go-live.md`.
 */
export const STRIPE_WEBHOOK_SECRET_ENV = "STRIPE_WEBHOOK_SECRET";
export const STRIPE_CONNECT_WEBHOOK_SECRET_ENV = "STRIPE_CONNECT_WEBHOOK_SECRET";
export const STRIPE_CONNECTED_ACCOUNT_WEBHOOK_SECRET_ENV =
	"STRIPE_CONNECTED_ACCOUNT_WEBHOOK_SECRET";

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

/**
 * A stable name for THIS Convex deployment, for stamping onto Stripe objects
 * (TAVLI-105).
 *
 * Several deployments share one Stripe test account — the two dev deployments
 * and staging all point at `acct_1TGR41AdCrGPY0BG` — and each of them stamps
 * `metadata.paymentId` onto every PaymentIntent it creates. Without a way to
 * tell whose intent an event describes, the webhook cannot distinguish "money
 * Tavli took and has no record of" (a severe operator alert, an email to every
 * platform admin) from "a charge another deployment created" (not our problem,
 * and constant). The marker is what separates them.
 *
 * Derived from `CONVEX_CLOUD_URL`, a system variable Convex sets in every
 * deployment: `https://brave-moose-354.convex.cloud` becomes
 * `brave-moose-354`. The slug rather than the URL because it is what appears in
 * the dashboard and in `.env.local`, so an operator reading the value off a
 * Stripe object recognises it. `CONVEX_SITE_URL` is the fallback — same slug,
 * different apex — and `undefined` is a legitimate answer outside a deployment
 * (unit tests), which every caller must tolerate.
 */
export function getDeploymentMarker(): string | undefined {
	const raw = process.env.CONVEX_CLOUD_URL ?? process.env.CONVEX_SITE_URL;
	if (!raw) return undefined;

	try {
		const host = new URL(raw).hostname;
		const slug = host.split(".")[0]?.trim();
		return slug || undefined;
	} catch {
		// Not a URL. Some other stable string is still better than nothing.
		const trimmed = raw.trim();
		return trimmed || undefined;
	}
}
