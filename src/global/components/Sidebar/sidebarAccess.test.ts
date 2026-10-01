import { SidebarKeys } from "@/global/i18n";
import { describe, expect, it } from "vitest";
import { sidebarItems } from "./constants";
import { filterSidebarItems, type SidebarAccess } from "./sidebarAccess";

/** Top-level entries, and each group's sub-links, as translation keys. */
function shape(access: SidebarAccess) {
	return filterSidebarItems(sidebarItems, access).map((item) =>
		item.type === "group"
			? { group: item.translationKey, links: item.subLinks.map((l) => l.translationKey) }
			: item.translationKey
	);
}

const EMPLOYEE: SidebarAccess = { isAdmin: false, isStaff: true, isManagerOrAbove: false };
const MANAGER: SidebarAccess = { isAdmin: false, isStaff: true, isManagerOrAbove: true };
const ADMIN: SidebarAccess = { isAdmin: true, isStaff: true, isManagerOrAbove: true };

describe("filterSidebarItems", () => {
	it("gives an employee only the pages an employee can open", () => {
		expect(shape(EMPLOYEE)).toEqual([
			SidebarKeys.DASHBOARD,
			SidebarKeys.ORDERS,
			SidebarKeys.RESERVATIONS,
			SidebarKeys.WHATSAPP,
			// The directory is manager-only; the employee's own schedule is not.
			{ group: SidebarKeys.TEAM, links: [SidebarKeys.SCHEDULE] },
		]);
	});

	it("hides the manager-only pages from an employee", () => {
		const keys = JSON.stringify(shape(EMPLOYEE));
		for (const key of [
			SidebarKeys.RESTAURANTS,
			SidebarKeys.MENUS,
			SidebarKeys.FINANCES,
			SidebarKeys.TEAM_INVITES,
			SidebarKeys.ADMIN,
		]) {
			expect(keys).not.toContain(key);
		}
	});

	it("gives a manager every restaurant page, but not the platform admin group", () => {
		const keys = JSON.stringify(shape(MANAGER));
		for (const key of [
			SidebarKeys.DASHBOARD,
			SidebarKeys.RESTAURANTS,
			SidebarKeys.MENUS,
			SidebarKeys.ORDERS,
			SidebarKeys.FINANCES,
			SidebarKeys.RESERVATIONS,
			SidebarKeys.WHATSAPP,
			SidebarKeys.TEAM_INVITES,
			SidebarKeys.SCHEDULE,
		]) {
			expect(keys).toContain(key);
		}
		expect(keys).not.toContain(SidebarKeys.ADMIN);
	});

	it("gives a platform admin everything, admin group included", () => {
		expect(filterSidebarItems(sidebarItems, ADMIN)).toHaveLength(sidebarItems.length);
	});

	it("gives someone with no staff role none of the staff pages", () => {
		expect(shape({ isAdmin: false, isStaff: false, isManagerOrAbove: false })).toEqual([]);
	});
});
