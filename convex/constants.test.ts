import { describe, expect, it } from "vitest";
import { ORDER_STATUS, SELECTION_TYPE, SESSION_STATUS, TABLE, USER_ROLES } from "./constants";

describe("TABLE constants", () => {
	it("contains all expected table names", () => {
		const expected = [
			"allEvents",
			"userSettings",
			"userRoles",
			"featureFlags",
			"restaurants",
			"tables",
			"menus",
			"menuCategories",
			"menuItems",
			"optionGroups",
			"options",
			"menuItemOptionGroups",
			"sessions",
			"orders",
			"orderItems",
		];
		expect(Object.values(TABLE).sort()).toEqual(expected.sort());
	});
});

describe("USER_ROLES", () => {
	it("has admin, owner, manager, customer, and employee", () => {
		expect(USER_ROLES.ADMIN).toBe("admin");
		expect(USER_ROLES.OWNER).toBe("owner");
		expect(USER_ROLES.MANAGER).toBe("manager");
		expect(USER_ROLES.CUSTOMER).toBe("customer");
		expect(USER_ROLES.EMPLOYEE).toBe("employee");
	});

	it("has exactly 5 roles", () => {
		expect(Object.keys(USER_ROLES)).toHaveLength(5);
	});
});

describe("ORDER_STATUS", () => {
	it("has all order statuses", () => {
		expect(ORDER_STATUS.DRAFT).toBe("draft");
		expect(ORDER_STATUS.SUBMITTED).toBe("submitted");
		expect(ORDER_STATUS.PREPARING).toBe("preparing");
		expect(ORDER_STATUS.READY).toBe("ready");
		expect(ORDER_STATUS.SERVED).toBe("served");
		expect(ORDER_STATUS.PAID).toBe("paid");
		expect(ORDER_STATUS.CANCELLED).toBe("cancelled");
	});

	it("has exactly 7 statuses", () => {
		expect(Object.keys(ORDER_STATUS)).toHaveLength(7);
	});
});

describe("SESSION_STATUS", () => {
	it("has active and closed", () => {
		expect(SESSION_STATUS.ACTIVE).toBe("active");
		expect(SESSION_STATUS.CLOSED).toBe("closed");
	});
});

describe("SELECTION_TYPE", () => {
	it("has single and multi", () => {
		expect(SELECTION_TYPE.SINGLE).toBe("single");
		expect(SELECTION_TYPE.MULTI).toBe("multi");
	});
});
