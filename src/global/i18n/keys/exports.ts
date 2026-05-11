/**
 * Translation keys for the Excel export feature: the year picker dialog,
 * the menu snapshot button, in-flight toasts, and error messages.
 */
export const ExportsKeys = {
	BUTTON: "exports.button",
	BUTTON_ARIA: "exports.button.aria",

	DIALOG_TITLE_ORDERS: "exports.dialog.title.orders",
	DIALOG_TITLE_PAYMENTS: "exports.dialog.title.payments",
	DIALOG_TITLE_RESERVATIONS: "exports.dialog.title.reservations",
	DIALOG_DESCRIPTION: "exports.dialog.description",
	DIALOG_YEAR_LABEL: "exports.dialog.yearLabel",
	DIALOG_CANCEL: "exports.dialog.cancel",
	DIALOG_CONFIRM: "exports.dialog.confirm",

	STATUS_PREPARING: "exports.status.preparing",
	STATUS_SUCCESS: "exports.status.success",
	STATUS_ERROR: "exports.status.error",
	STATUS_TOO_LARGE: "exports.status.tooLarge",

	NO_YEARS: "exports.noYears",
} as const;

export type ExportsKey = (typeof ExportsKeys)[keyof typeof ExportsKeys];
