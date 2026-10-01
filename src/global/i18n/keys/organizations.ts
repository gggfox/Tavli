/**
 * Translation keys for the platform-admin Organizations page
 * (`features/organizations`).
 */
export const OrganizationsKeys = {
	SEARCH_PLACEHOLDER: "organizations.list.searchPlaceholder",
	/** Pluralized: pass `{ count }`. */
	RESULT_COUNT: "organizations.list.resultCount",
	EMPTY_TITLE: "organizations.list.emptyTitle",
	EMPTY_DESCRIPTION: "organizations.list.emptyDescription",
	FILTERED_EMPTY_TITLE: "organizations.list.filteredEmptyTitle",
	NOT_AUTHENTICATED: "organizations.list.notAuthenticated",
	NEW: "organizations.list.new",
	EDIT: "organizations.list.edit",
	DELETE: "organizations.list.delete",

	COLUMN_ID: "organizations.column.id",
	COLUMN_NAME: "organizations.column.name",
	COLUMN_DESCRIPTION: "organizations.column.description",
	COLUMN_STATUS: "organizations.column.status",
	COLUMN_CREATED: "organizations.column.created",
	COLUMN_UPDATED: "organizations.column.updated",
	STATUS_ACTIVE: "organizations.status.active",
	STATUS_INACTIVE: "organizations.status.inactive",

	FORM_CREATE_TITLE: "organizations.form.createTitle",
	FORM_EDIT_TITLE: "organizations.form.editTitle",
	FORM_CLOSE: "organizations.form.close",
	FORM_NAME_LABEL: "organizations.form.nameLabel",
	FORM_NAME_PLACEHOLDER: "organizations.form.namePlaceholder",
	FORM_SLUG_LABEL: "organizations.form.slugLabel",
	FORM_DESCRIPTION_LABEL: "organizations.form.descriptionLabel",
	FORM_DESCRIPTION_PLACEHOLDER: "organizations.form.descriptionPlaceholder",
	FORM_AI_LIMIT_LABEL: "organizations.form.aiLimitLabel",
	/** The backend names the field but words the reason in English prose. */
	FORM_NAME_INVALID: "organizations.form.nameInvalid",
	FORM_AI_LIMIT_INVALID: "organizations.form.aiLimitInvalid",
	FORM_SAVE_FAILED: "organizations.form.saveFailed",
	FORM_CANCEL: "organizations.form.cancel",
	FORM_SAVING: "organizations.form.saving",
	FORM_SAVE: "organizations.form.save",
	FORM_CREATE: "organizations.form.create",

	DELETE_TITLE: "organizations.delete.title",
	/** Rendered with `<Trans>`: `<name/>` is replaced by the bolded organization name. */
	DELETE_CONFIRM: "organizations.delete.confirm",
	DELETE_IRREVERSIBLE: "organizations.delete.irreversible",
	DELETE_HAS_USERS: "organizations.delete.hasUsers",
	DELETE_FAILED: "organizations.delete.failed",
	DELETE_CANCEL: "organizations.delete.cancel",
	DELETE_DELETING: "organizations.delete.deleting",
	DELETE_BUTTON: "organizations.delete.button",
} as const;

export type OrganizationsKey = (typeof OrganizationsKeys)[keyof typeof OrganizationsKeys];
