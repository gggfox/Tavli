import { SidebarKeys, type SidebarKey } from "@/global/i18n";
import type { SidebarItem } from "./SidebarLink";

/**
 * Entries any active staff member of the restaurant can use, employees
 * included. Each one's page reads through `requireRestaurantStaffAccess` (or
 * `requireStaffAt`), and the pages that also hold manager-only actions gate
 * those actions themselves: the dashboard filters widgets by `requiredRole`,
 * and the schedule falls back to the employee's own shifts.
 */
const STAFF_KEYS = new Set<SidebarKey>([
	SidebarKeys.DASHBOARD,
	SidebarKeys.ORDERS,
	SidebarKeys.RESERVATIONS,
	SidebarKeys.WHATSAPP,
	SidebarKeys.TEAM,
	SidebarKeys.SCHEDULE,
]);

/**
 * Entries whose page loads only for a manager or above
 * (`requireRestaurantManagerOrAbove` on the queries they open with): restaurant
 * settings, the menu editor, payments and payouts, and the team directory.
 * Shown to an employee they were a dead end — the link worked and the page
 * answered with an error panel.
 */
const MANAGER_KEYS = new Set<SidebarKey>([
	SidebarKeys.RESTAURANTS,
	SidebarKeys.MENUS,
	SidebarKeys.OPTIONS,
	SidebarKeys.FINANCES,
	SidebarKeys.TEAM_INVITES,
]);

export type SidebarAccess = Readonly<{
	/** Platform admin: everything, including the ADMIN group. */
	isAdmin: boolean;
	/** Holds any staff role (admin, owner, manager, employee). */
	isStaff: boolean;
	/** Manager or above **for the restaurant currently selected**. */
	isManagerOrAbove: boolean;
}>;

function canSee(key: SidebarKey, access: SidebarAccess): boolean {
	if (key === SidebarKeys.ADMIN) return access.isAdmin;
	if (MANAGER_KEYS.has(key)) return access.isStaff && access.isManagerOrAbove;
	if (STAFF_KEYS.has(key)) return access.isStaff;
	return true;
}

/**
 * The sidebar a user should see. A group keeps only the sub-links the user
 * can open, and disappears when none are left, so an employee's "Team" group
 * holds just their schedule rather than a directory they cannot load.
 */
export function filterSidebarItems(
	items: readonly SidebarItem[],
	access: SidebarAccess
): SidebarItem[] {
	const visible: SidebarItem[] = [];
	for (const item of items) {
		if (!canSee(item.translationKey, access)) continue;
		if (item.type === "link") {
			visible.push(item);
			continue;
		}
		// The ADMIN group's children are all platform-admin pages and were
		// already decided by the group itself.
		if (item.translationKey === SidebarKeys.ADMIN) {
			visible.push(item);
			continue;
		}
		const subLinks = item.subLinks.filter((link) => canSee(link.translationKey, access));
		if (subLinks.length > 0) visible.push({ ...item, subLinks });
	}
	return visible;
}
