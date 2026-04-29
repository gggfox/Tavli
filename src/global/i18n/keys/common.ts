/**
 * Cross-feature translation keys for shared primitives like the Button
 * component. Add a new key here whenever a generic UI element ships a
 * default label that benefits from localization.
 */
export const CommonKeys = {
	BUTTON_SAVED: "common.button.saved",
	BUTTON_FAILED: "common.button.failed",
	BUTTON_SAVING: "common.button.saving",
	/**
	 * Pluralized "N items" / "1 item". Resolves via i18next's `_one` /
	 * `_other` plural suffixes -- pass `{ count }` as the interpolation arg.
	 */
	ITEMS_COUNT: "common.itemsCount",
} as const;

export type CommonKey = (typeof CommonKeys)[keyof typeof CommonKeys];
