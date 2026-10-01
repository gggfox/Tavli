/**
 * Translation keys for the platform-admin Feature Flags page
 * (`features/featureFlags`). Flag keys and their descriptions come from
 * `FEATURE_FLAG_METADATA` in code and are shown as written.
 */
export const FeatureFlagsKeys = {
	NONE_REGISTERED_TITLE: "featureFlags.noneRegistered.title",
	NONE_REGISTERED_DESCRIPTION: "featureFlags.noneRegistered.description",
	LOADING: "featureFlags.loading",
	LOAD_FAILED: "featureFlags.loadFailed",
	RETRY: "featureFlags.retry",
	COLUMN_KEY: "featureFlags.column.key",
	COLUMN_DESCRIPTION: "featureFlags.column.description",
	COLUMN_UPDATED_AT: "featureFlags.column.updatedAt",
	COLUMN_UPDATED_BY: "featureFlags.column.updatedBy",
	COLUMN_NUMERIC_VALUE: "featureFlags.column.numericValue",
	COLUMN_STATUS: "featureFlags.column.status",
	/** "Numeric value for {{flag}}" */
	NUMERIC_VALUE_ARIA: "featureFlags.numericValueAria",
	/** "Enable {{flag}}" / "Disable {{flag}}" */
	ENABLE_ARIA: "featureFlags.enableAria",
	DISABLE_ARIA: "featureFlags.disableAria",
} as const;

export type FeatureFlagsKey = (typeof FeatureFlagsKeys)[keyof typeof FeatureFlagsKeys];
