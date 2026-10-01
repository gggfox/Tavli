/**
 * Translation keys for the platform-admin Users page table
 * (`features/users/components/UsersTable`). Role names come from `RoleKeys`;
 * the invite dialogs use `UserOnboardingKeys`.
 */
export const UsersKeys = {
	SEARCH_PLACEHOLDER: "users.list.searchPlaceholder",
	/** Pluralized: pass `{ count }`. */
	RESULT_COUNT: "users.list.resultCount",
	EMPTY_TITLE: "users.list.emptyTitle",
	EMPTY_DESCRIPTION: "users.list.emptyDescription",
	FILTERED_EMPTY_TITLE: "users.list.filteredEmptyTitle",
	NOT_AUTHENTICATED: "users.list.notAuthenticated",
	COLUMN_USER_ID: "users.column.userId",
	COLUMN_EMAIL: "users.column.email",
	COLUMN_ROLES: "users.column.roles",
	COLUMN_ORGANIZATION: "users.column.organization",
	COLUMN_CREATED: "users.column.created",
	COLUMN_UPDATED: "users.column.updated",
} as const;

export type UsersKey = (typeof UsersKeys)[keyof typeof UsersKeys];
