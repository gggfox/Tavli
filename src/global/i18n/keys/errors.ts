/**
 * Stable backend error codes and their i18n keys.
 *
 * The Convex backend surfaces errors as **stable string codes** (see
 * `convex/_shared/errors.ts`, `convex/_util/auth.ts`, and the `ERROR_*`
 * literals thrown across `convex/`). The frontend must never render those raw
 * codes (or the `[CONVEX M(...)] … CODE` wrapper Convex adds around them) to a
 * user — it maps each code to a localized message under the `errors.<CODE>`
 * namespace via `getErrorMessage` (see `src/global/utils/errorMessages.ts`).
 *
 * When the backend gains a new thrown code, add it to `BACKEND_ERROR_CODES`
 * here and add the matching `errors.<CODE>` entry to both `locales/en.json`
 * and `locales/es.json`. The locale-parity test enforces that every value in
 * `ErrorKeys` resolves in both locales.
 */

/**
 * Every stable code the Convex backend can surface to the client, grouped by
 * origin module. Keep this in sync with the backend — these are the exact
 * string literals thrown (or carried on error `name`) server-side.
 */
export const BACKEND_ERROR_CODES = [
	// ERROR_NAMES — convex/_shared/errors.ts (carried on error `name`)
	"NOT_AUTHENTICATED",
	"NOT_AUTHORIZED",
	"NOT_FOUND",
	"BAD_REQUEST",
	"INTERNAL_SERVER_ERROR",
	"SERVICE_UNAVAILABLE",
	"TIMEOUT",
	"CONFLICT",
	"VALIDATION_ERROR",
	"IDEMPOTENCY_KEY_CONFLICT",
	"INVALID_AUCTION_STATE",
	// Role / auth — convex/_util/auth.ts
	"ERROR_ADMIN_ROLE_REQUIRED",
	"ERROR_OWNER_ROLE_REQUIRED",
	"ERROR_MANAGER_ROLE_REQUIRED",
	"ERROR_CUSTOMER_ROLE_REQUIRED",
	"ERROR_EMPLOYEE_ROLE_REQUIRED",
	"ERROR_INSUFFICIENT_ROLES",
	"ERROR_SHARED_SESSION_REQUIRED",
	"ERROR_PIN_LOCKED",
	"ERROR_INVALID_PIN",
	// Diner session — convex/_util/dinerSession.ts
	"ERROR_SESSION_ACCESS_DENIED",
	"ERROR_TAB_LOCKED",
	"ERROR_INVALID_JOIN_CODE",
	"ERROR_TAB_EMPTY",
	// Admin — convex/admin.ts
	"ERROR_DEV_ENVIRONMENT_ONLY",
	// Analytics / dashboards — convex/analytics/_shared.ts, convex/dashboard*.ts
	"ERROR_DASHBOARD_RESTAURANT_REQUIRED",
	"ERROR_DASHBOARD_RANGE_TOO_LARGE",
	"ERROR_DASHBOARD_RANGE_INVALID",
	"ERROR_DASHBOARD_NAME_REQUIRED",
	"ERROR_DASHBOARD_NAME_TOO_LONG",
	"ERROR_DASHBOARD_DESCRIPTION_TOO_LONG",
	"ERROR_DASHBOARD_LAYOUT_NOT_OWNER",
	"ERROR_DASHBOARD_TOO_MANY_LAYOUTS",
	"ERROR_DASHBOARD_PORTFOLIO_NO_MEMBERSHIP",
	// Invites — convex/invites.ts
	"ERROR_EMAIL_NOT_VERIFIED",
	// Menus — convex/menus.ts
	"ERROR_MENU_CATEGORY_NAME_REQUIRED",
	"ERROR_MENU_CATEGORY_NAME_TOO_LONG",
	"ERROR_MENU_CATEGORY_NAMES_REQUIRED",
	// Reservations — convex/reservationHelpers.ts, convex/reservations.ts
	"ERROR_INVALID_PARTY_SIZE",
	"ERROR_CONTACT_FIELD_TOO_LONG",
	"ERROR_INVALID_EMAIL",
	"ERROR_NOTES_TOO_LONG",
	"ERROR_RESERVATION_RATE_LIMITED",
	"ERROR_NO_TABLES_AVAILABLE",
	"ERROR_NOT_ACCEPTING_RESERVATIONS",
	"ERROR_OUTSIDE_BOOKING_HORIZON",
	"ERROR_BLACKOUT_WINDOW",
	"ERROR_TABLE_UNAVAILABLE",
	"ERROR_TABLE_LOCKED",
	// Restaurants / shared employee session — convex/restaurants.ts
	"ERROR_SHARED_EMPLOYEE_SUBJECT_ALREADY_BOUND",
	"ERROR_INVALID_SHARED_EMPLOYEE_CLERK_SUBJECT",
	// Tables & table locks — convex/tables.ts, convex/tableLocks.ts
	"ERROR_TABLE_HAS_RESERVATIONS",
	"ERROR_TABLE_NUMBER_EXISTS",
] as const;

export type BackendErrorCode = (typeof BACKEND_ERROR_CODES)[number];

/** Maps each stable backend code to its `errors.<CODE>` i18n key. */
export const ERROR_CODE_KEYS = Object.fromEntries(
	BACKEND_ERROR_CODES.map((code) => [code, `errors.${code}`])
) as Record<BackendErrorCode, string>;

/**
 * Typed i18n keys for the error UI plus every mapped backend code. Registered
 * in `locales.test.ts` so EN/ES stay in sync.
 */
export const ErrorKeys = {
	/** Localized catch-all for unknown / unspecified errors. */
	GENERIC: "errors.generic",
	// ErrorBoundary fallback UI
	BOUNDARY_TITLE: "errors.boundary.title",
	BOUNDARY_DESCRIPTION: "errors.boundary.description",
	BOUNDARY_SESSION_TITLE: "errors.boundary.sessionTitle",
	BOUNDARY_SESSION_DESCRIPTION: "errors.boundary.sessionDescription",
	BOUNDARY_RETRY: "errors.boundary.retry",
	BOUNDARY_RELOAD: "errors.boundary.reload",
	BOUNDARY_SIGN_IN: "errors.boundary.signIn",
	// DashboardShell fallback UI
	DASHBOARD_LOAD_FAILED: "errors.dashboardShell.loadFailed",
	DASHBOARD_LOAD_HINT: "errors.dashboardShell.loadHint",
	...ERROR_CODE_KEYS,
} as const;

export type ErrorKey = (typeof ErrorKeys)[keyof typeof ErrorKeys];
