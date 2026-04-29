/**
 * Translation keys for role names
 */
export const RoleKeys = {
	ADMIN: "roles.admin",
	OWNER: "roles.owner",
	MANAGER: "roles.manager",
	CUSTOMER: "roles.customer",
	EMPLOYEE: "roles.employee",
} as const;

export type RoleKey = (typeof RoleKeys)[keyof typeof RoleKeys];
