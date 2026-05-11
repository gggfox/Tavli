/**
 * Translation keys for the Excel export feature: the export button (with its
 * year-picker popover), the menu snapshot button, in-flight toasts, and error
 * messages.
 */
export const ExportsKeys = {
	BUTTON: "exports.button",
	BUTTON_ARIA: "exports.button.aria",

	STATUS_PREPARING: "exports.status.preparing",
	STATUS_SUCCESS: "exports.status.success",
	STATUS_ERROR: "exports.status.error",
	STATUS_TOO_LARGE: "exports.status.tooLarge",

	NO_YEARS: "exports.noYears",
} as const;

export type ExportsKey = (typeof ExportsKeys)[keyof typeof ExportsKeys];
