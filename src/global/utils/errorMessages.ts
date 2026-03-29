/**
 * Error message utilities for i18n-compatible error handling.
 *
 * Backend errors use error codes (e.g., "ERROR_SELLER_REQUIRED") that can be
 * mapped to i18n keys for user-friendly, localized error messages.
 */

/**
 * Known error codes from the backend.
 * These match the codes defined in convex/_util/auth.ts
 */
export const ErrorCodes = {
	ADMIN_REQUIRED: "ERROR_ADMIN_REQUIRED",
	MANAGER_REQUIRED: "ERROR_MANAGER_REQUIRED",
	INSUFFICIENT_PERMISSIONS: "ERROR_INSUFFICIENT_PERMISSIONS",
} as const;

/**
 * Check if a string is a known error code.
 */
export function isErrorCode(message: string): boolean {
	return Object.values(ErrorCodes).includes(
		message as (typeof ErrorCodes)[keyof typeof ErrorCodes]
	);
}

/**
 * Extract error code from various error formats.
 * Handles:
 * - Direct error codes: "ERROR_SELLER_REQUIRED"
 * - Convex error format: "[CONVEX M(...)] Server Error Uncaught Error: ERROR_SELLER_REQUIRED at..."
 * - Regular Error objects
 */
export function extractErrorCode(error: unknown): string | null {
	let message = "";

	if (error instanceof Error) {
		message = error.message;
	} else if (typeof error === "string") {
		message = error;
	} else if (error && typeof error === "object" && "message" in error) {
		message = String((error as { message: unknown }).message);
	} else {
		return null;
	}

	// Check if the message directly is an error code
	if (isErrorCode(message)) {
		return message;
	}

	// Try to extract error code from Convex error format
	// Pattern: "Uncaught Error: ERROR_CODE at..." or just "ERROR_CODE"
	for (const code of Object.values(ErrorCodes)) {
		if (message.includes(code)) {
			return code;
		}
	}

	return null;
}

/**
 * Get the i18n key for an error.
 * If the error contains a known error code, returns the corresponding i18n key.
 * Otherwise, returns the fallback key.
 */
export function getErrorI18nKey(error: unknown, fallbackKey = "errors.generic"): string {
	const code = extractErrorCode(error);

	if (code) {
		// Error codes map directly to i18n keys under "errors"
		return `errors.${code}`;
	}

	return fallbackKey;
}
