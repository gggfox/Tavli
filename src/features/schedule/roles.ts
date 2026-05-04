/**
 * Shared role-to-label and role-to-color helpers for the schedule UI.
 *
 * Keeping these centralized means a future per-restaurant role taxonomy only
 * needs to update one place to feed both the drawer's role dropdown and the
 * grid chip palette. Colors are tailwind utility strings selected to map to
 * semantic background + foreground that work in light and dark mode.
 */
import { AdminStaffKeys } from "@/global/i18n";
import { SHIFT_ROLE, type ShiftRole } from "convex/constants";
import type { TFunction } from "i18next";

export const SHIFT_ROLE_OPTIONS: ShiftRole[] = [
	SHIFT_ROLE.SERVER,
	SHIFT_ROLE.BARTENDER,
	SHIFT_ROLE.HOST,
	SHIFT_ROLE.KITCHEN,
	SHIFT_ROLE.MANAGER,
];

export function shiftRoleLabel(role: ShiftRole | string | undefined, t: TFunction): string {
	switch (role) {
		case SHIFT_ROLE.SERVER:
			return t(AdminStaffKeys.SCHEDULE_ROLE_SERVER);
		case SHIFT_ROLE.BARTENDER:
			return t(AdminStaffKeys.SCHEDULE_ROLE_BARTENDER);
		case SHIFT_ROLE.HOST:
			return t(AdminStaffKeys.SCHEDULE_ROLE_HOST);
		case SHIFT_ROLE.KITCHEN:
			return t(AdminStaffKeys.SCHEDULE_ROLE_KITCHEN);
		case SHIFT_ROLE.MANAGER:
			return t(AdminStaffKeys.SCHEDULE_ROLE_MANAGER);
		default:
			return role ?? t(AdminStaffKeys.SCHEDULE_DRAWER_ROLE_NONE);
	}
}

export interface RoleChipStyle {
	readonly bg: string;
	readonly fg: string;
	readonly border: string;
}

const FALLBACK: RoleChipStyle = {
	bg: "bg-muted",
	fg: "text-foreground",
	border: "border-border",
};

const BY_ROLE: Record<ShiftRole, RoleChipStyle> = {
	[SHIFT_ROLE.SERVER]: {
		bg: "bg-sky-500/15",
		fg: "text-sky-700 dark:text-sky-200",
		border: "border-sky-500/30",
	},
	[SHIFT_ROLE.BARTENDER]: {
		bg: "bg-fuchsia-500/15",
		fg: "text-fuchsia-700 dark:text-fuchsia-200",
		border: "border-fuchsia-500/30",
	},
	[SHIFT_ROLE.HOST]: {
		bg: "bg-amber-500/15",
		fg: "text-amber-800 dark:text-amber-200",
		border: "border-amber-500/30",
	},
	[SHIFT_ROLE.KITCHEN]: {
		bg: "bg-orange-500/15",
		fg: "text-orange-800 dark:text-orange-200",
		border: "border-orange-500/30",
	},
	[SHIFT_ROLE.MANAGER]: {
		bg: "bg-emerald-500/15",
		fg: "text-emerald-800 dark:text-emerald-200",
		border: "border-emerald-500/30",
	},
};

export function shiftRoleChipStyle(role: ShiftRole | string | undefined): RoleChipStyle {
	if (!role) return FALLBACK;
	const known = (SHIFT_ROLE_OPTIONS as readonly string[]).includes(role)
		? (role as ShiftRole)
		: null;
	if (!known) return FALLBACK;
	return BY_ROLE[known];
}

const DAY_KEYS = [
	AdminStaffKeys.SCHEDULE_DAY_MON,
	AdminStaffKeys.SCHEDULE_DAY_TUE,
	AdminStaffKeys.SCHEDULE_DAY_WED,
	AdminStaffKeys.SCHEDULE_DAY_THU,
	AdminStaffKeys.SCHEDULE_DAY_FRI,
	AdminStaffKeys.SCHEDULE_DAY_SAT,
	AdminStaffKeys.SCHEDULE_DAY_SUN,
];

export function dayLabel(monStartIndex: number, t: TFunction): string {
	const idx = ((monStartIndex % 7) + 7) % 7;
	return t(DAY_KEYS[idx]);
}
