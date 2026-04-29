/**
 * Translation keys for the staff-facing option groups admin UI.
 */
export const OptionsKeys = {
	TRANSLATING_HINT: "options.translatingHint",
	NEW_GROUP_BUTTON: "options.newGroupButton",
	GROUP_NAME_PLACEHOLDER: "options.groupNamePlaceholder",
	SELECTION_SINGLE: "options.selectionSingle",
	SELECTION_MULTI: "options.selectionMulti",
	REQUIRED_LABEL: "options.requiredLabel",
	CREATE_BUTTON: "options.createButton",
	CANCEL_BUTTON: "options.cancelButton",
	GROUP_TRANSLATION_PLACEHOLDER: "options.groupTranslationPlaceholder",
	OPTION_TRANSLATION_PLACEHOLDER: "options.optionTranslationPlaceholder",
	GROUP_NAME_INLINE_PLACEHOLDER: "options.groupNameInlinePlaceholder",
	TYPE_SINGLE: "options.typeSingle",
	TYPE_MULTI: "options.typeMulti",
	TYPE_REQUIRED: "options.typeRequired",
	TYPE_OPTIONAL: "options.typeOptional",
	OPTION_NAME_PLACEHOLDER: "options.optionNamePlaceholder",
	OPTION_PRICE_PLACEHOLDER: "options.optionPricePlaceholder",
} as const;

export type OptionsKey = (typeof OptionsKeys)[keyof typeof OptionsKeys];
