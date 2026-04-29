/**
 * Translation keys for the staff-facing menu admin UI: list, editor,
 * categories, items, image manager, translations, and language settings.
 */
export const MenusKeys = {
	LIST_NEW_PLACEHOLDER: "menus.list.newPlaceholder",
	LIST_ADD_BUTTON: "menus.list.addButton",
	LIST_TOGGLE_DEACTIVATE: "menus.list.toggleDeactivate",
	LIST_TOGGLE_ACTIVATE: "menus.list.toggleActivate",
	LIST_RENAME: "menus.list.rename",
	LIST_DELETE: "menus.list.delete",
	LIST_EMPTY: "menus.list.empty",
	LIST_LOADING_ARIA: "menus.list.loadingAria",

	EDITOR_LANGUAGES_LABEL: "menus.editor.languagesLabel",
	EDITOR_LANGUAGES_TITLE: "menus.editor.languagesTitle",
	EDITOR_OPTIONS_LABEL: "menus.editor.optionsLabel",
	EDITOR_OPTIONS_TITLE: "menus.editor.optionsTitle",
	EDITOR_OPTION_GROUPS_MODAL_ARIA: "menus.editor.optionGroupsModalAria",
	EDITOR_OPTION_GROUPS_HEADING: "menus.editor.optionGroupsHeading",
	EDITOR_OPTION_GROUPS_DESCRIPTION: "menus.editor.optionGroupsDescription",
	EDITOR_NEW_CATEGORY_PLACEHOLDER: "menus.editor.newCategoryPlaceholder",
	EDITOR_ADD_CATEGORY: "menus.editor.addCategory",
	EDITOR_TRANSLATING_HINT: "menus.editor.translatingHint",
	EDITOR_NO_CATEGORIES: "menus.editor.noCategories",
	EDITOR_LOADING_ARIA: "menus.editor.loadingAria",

	CATEGORY_ITEMS_COUNT: "menus.category.itemsCount",
	CATEGORY_TRANSLATION_PLACEHOLDER: "menus.category.translationPlaceholder",
	CATEGORY_DELETE_TITLE: "menus.category.deleteTitle",
	CATEGORY_ADD_ITEM: "menus.category.addItem",

	ITEM_EDIT_TITLE: "menus.item.editTitle",
	ITEM_IMAGE_TITLE: "menus.item.imageTitle",
	ITEM_OPTIONS_TITLE: "menus.item.optionsTitle",
	ITEM_MARK_UNAVAILABLE: "menus.item.markUnavailable",
	ITEM_MARK_AVAILABLE: "menus.item.markAvailable",
	ITEM_REMOVE_TITLE: "menus.item.removeTitle",

	TRANSLATION_NAME_PLACEHOLDER: "menus.translation.namePlaceholder",
	TRANSLATION_DESC_PLACEHOLDER: "menus.translation.descPlaceholder",
	TRANSLATION_DESC_LABEL: "menus.translation.descLabel",

	FORM_ITEM_NAME_PLACEHOLDER: "menus.form.itemNamePlaceholder",
	FORM_ITEM_PRICE_PLACEHOLDER: "menus.form.itemPricePlaceholder",
	FORM_ITEM_DESCRIPTION_PLACEHOLDER: "menus.form.itemDescriptionPlaceholder",
	FORM_CHANGE_IMAGE: "menus.form.changeImage",
	FORM_ADD_IMAGE: "menus.form.addImage",
	FORM_PASTE_HINT: "menus.form.pasteHint",
	FORM_UPLOADING: "menus.form.uploading",
	FORM_ADD: "menus.form.add",
	FORM_CANCEL: "menus.form.cancel",
	FORM_SAVING: "menus.form.saving",
	FORM_SAVE: "menus.form.save",
	FORM_EDIT_HEADER: "menus.form.editHeader",
	FORM_REPLACE_IMAGE: "menus.form.replaceImage",
	FORM_UPLOAD_IMAGE: "menus.form.uploadImage",
	FORM_REMOVE: "menus.form.remove",
	FORM_IMAGE_HEADER: "menus.form.imageHeader",

	PICKER_NO_GROUPS: "menus.picker.noGroups",
	PICKER_LINKED_GROUPS: "menus.picker.linkedGroups",
	PICKER_GROUP_SINGLE: "menus.picker.groupSingle",
	PICKER_GROUP_MULTI: "menus.picker.groupMulti",

	LANG_DEFAULT_LABEL: "menus.lang.defaultLabel",
	LANG_ADDITIONAL_LABEL: "menus.lang.additionalLabel",
} as const;

export type MenusKey = (typeof MenusKeys)[keyof typeof MenusKeys];
