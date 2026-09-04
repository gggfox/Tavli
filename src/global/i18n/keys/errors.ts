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
	"APP_URL_NOT_CONFIGURED",
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
	"ERROR_TAB_UNPAID",
	"ERROR_TAB_HAS_UNSERVED_ORDERS",
	"ERROR_SESSION_AWAITING_PAYMENT_ORDERS",
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
	// Admin user onboarding — convex/inviteOnboardingHelpers.ts.
	// The row verdicts are derived mechanically by `inviteRowErrorCode`
	// (`cross_org` → `ERROR_INVITE_CROSS_ORG`, …); only the BLOCKING verdicts
	// are listed, because `ok` and `already_member` never travel as an error.
	"ERROR_INVITE_CROSS_ORG",
	"ERROR_INVITE_DUPLICATE_PENDING",
	"ERROR_INVITE_DUPLICATE_IN_FILE",
	"ERROR_INVITE_INVALID_EMAIL",
	"ERROR_INVITE_INVALID_ROLE",
	"ERROR_INVITE_INVALID_ORGANIZATION",
	"ERROR_INVITE_INVALID_ORGANIZATION_AMBIGUOUS",
	"ERROR_INVITE_INVALID_RESTAURANTS_REQUIRED",
	"ERROR_INVITE_INVALID_RESTAURANT_UNKNOWN",
	"ERROR_INVITE_INVALID_RESTAURANT_AMBIGUOUS",
	"ERROR_INVITE_INVALID_RESTAURANT_OTHER_ORG",
	// convex/inviteRateLimit.ts
	"ERROR_INVITE_RATE_LIMITED",
	"ERROR_INVITE_EMAIL_RATE_LIMITED",
	// convex/inviteOnboarding.ts + convex/inviteOnboardingHelpers.ts (file-level)
	"ERROR_INVITE_BULK_TOO_MANY_ROWS",
	"ERROR_INVITE_CSV_EMPTY",
	"ERROR_INVITE_CSV_MISSING_COLUMN",
	"ERROR_INVITE_CSV_UNKNOWN_COLUMN",
	"ERROR_INVITE_CSV_DUPLICATE_COLUMN",
	"ERROR_INVITE_CSV_TOO_MANY_ROWS",
	"ERROR_INVITE_CSV_TOO_LARGE",
	"ERROR_INVITE_CSV_NOT_CSV",
	"ERROR_INVITE_CSV_UNTERMINATED_QUOTE",
	// Orders / refunds — convex/orders.ts, convex/stripe.ts
	"ERROR_ORDER_NOT_CANCELLABLE",
	"ERROR_ORDER_ITEM_NOT_CANCELLABLE",
	"ERROR_ORDER_ITEM_CANCEL_PAID",
	"ERROR_ORDER_ITEM_CANCEL_TAB_LOCKED",
	"ERROR_ORDER_PAYMENT_IN_FLIGHT",
	"ERROR_REFUND_FAILED",
	"ERROR_REFUND_PAYMENT_UNRESOLVED",
	"ERROR_REFUND_ALREADY_ISSUED",
	// Substitutions — convex/substitutions.ts, convex/stripe.ts (TAVLI-71 Phase 3A)
	"ERROR_SUBSTITUTION_NOT_ELIGIBLE",
	"ERROR_SUBSTITUTION_ITEM_UNAVAILABLE",
	"ERROR_SUBSTITUTION_PROPOSAL_EXISTS",
	"ERROR_SUBSTITUTION_DELTA_NEGATIVE",
	"ERROR_SUBSTITUTION_NOT_PENDING",
	"ERROR_SUBSTITUTION_REQUIRES_PAYMENT",
	// Post-visit tips — convex/stripe.ts (TAVLI-71 Phase 3B)
	"ERROR_TIP_INVALID_AMOUNT",
	// Receipt emails — convex/receiptActions.ts (TAVLI-71 Phase 3C)
	"ERROR_RECEIPT_ORDER_NOT_PAID",
	"ERROR_RECEIPT_NO_VERIFIED_EMAIL",
	"ERROR_RECEIPT_RATE_LIMITED",
	"ERROR_RECEIPT_SEND_FAILED",
	// Platform subscription — convex/billing.ts, convex/_util/env.ts (TAVLI-71 Phase 4B)
	"ERROR_BILLING_NOT_ENABLED",
	"ERROR_BILLING_PRICE_NOT_CONFIGURED",
	"ERROR_BILLING_SUBSCRIPTION_EXISTS",
	"ERROR_BILLING_NO_SUBSCRIPTION",
	"ERROR_BILLING_CHECKOUT_FAILED",
	"ERROR_BILLING_PORTAL_UNAVAILABLE",
	// Menus — convex/menus.ts, convex/menuImportMutation.ts
	"ERROR_MENU_CATEGORY_NAME_REQUIRED",
	"ERROR_MENU_CATEGORY_NAME_TOO_LONG",
	"ERROR_MENU_CATEGORY_NAMES_REQUIRED",
	"ERROR_MENU_NAME_REQUIRED",
	"ERROR_MENU_NAME_TOO_LONG",
	"ERROR_MENU_IMPORT_TARGET_REQUIRED",
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
	"ERROR_OUTSIDE_OPERATING_HOURS",
	"ERROR_AMBIGUOUS_RESERVATION",
	"ERROR_TABLE_UNAVAILABLE",
	"ERROR_TABLE_LOCKED",
	// Restaurants / shared employee session — convex/restaurants.ts
	"ERROR_SHARED_EMPLOYEE_SUBJECT_ALREADY_BOUND",
	"ERROR_INVALID_SHARED_EMPLOYEE_CLERK_SUBJECT",
	// Public profile — convex/publicProfileHelpers.ts (`PUBLIC_PROFILE_ERROR`)
	"ERROR_INVALID_SUPPORT_EMAIL",
	"ERROR_ADDRESS_TOO_LONG",
	"ERROR_INVALID_PHONE",
	"ERROR_PHONE_COUNTRY_CODE_REQUIRED",
	"ERROR_WHATSAPP_WITHOUT_PHONE",
	"ERROR_SOCIAL_URL_INVALID",
	"ERROR_SOCIAL_URL_WRONG_PLATFORM",
	"ERROR_SOCIAL_URL_SHORTLINK",
	"ERROR_SOCIAL_URL_INSECURE",
	// Branding — convex/brandingHelpers.ts (`BRANDING_ERROR`)
	"ERROR_BRANDING_COLOR_INVALID",
	"ERROR_BRANDING_IMAGE_TOO_LARGE",
	"ERROR_BRANDING_IMAGE_TYPE_INVALID",
	"ERROR_BRANDING_IMAGE_DIMENSIONS_INVALID",
	// Public restaurant slug — convex/slugHelpers.ts (`SLUG_ERROR`)
	"ERROR_SLUG_TAKEN",
	"ERROR_SLUG_INVALID",
	// Tables & table locks — convex/tables.ts, convex/tableLocks.ts
	"ERROR_TABLE_HAS_RESERVATIONS",
	"ERROR_TABLE_NUMBER_EXISTS",
	// WhatsApp spend allowlist — convex/whatsappSpendAllowlist.ts
	"ERROR_PHONE_ALREADY_ALLOWLISTED",
	"ERROR_ALLOWLIST_ENTRY_NOT_FOUND",
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
