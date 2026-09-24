import {
	RESTAURANT_SETTINGS_NAV,
	type RestaurantSettingsNavId,
} from "@/features/restaurants/constants";
import { RestaurantsKeys } from "@/global/i18n";
import type { Doc } from "convex/_generated/dataModel";
import type { TFunction } from "i18next";
import {
	Building2,
	Clock,
	CreditCard,
	FileText,
	Globe,
	LayoutGrid,
	MapPin,
	MessageCircle,
	Palette,
	ReceiptText,
	Store,
	Users,
	type LucideIcon,
} from "lucide-react";

/** Who is looking, which decides which entries exist at all. */
export interface SettingsNavAccess {
	/** Org admins/owners; managers get the operational sections only. */
	readonly isFullAccess: boolean;
	/** Platform admin. */
	readonly isAdmin: boolean;
	/**
	 * Platform admin or this restaurant's own owner (see `PaymentsSection`).
	 * True while Clerk is still resolving, so the entry doesn't blink in.
	 */
	readonly canActOnStripe: boolean;
	/** The tables canvas is reachable from here. */
	readonly canManageTables: boolean;
}

export interface SettingsNavEntry {
	readonly id: RestaurantSettingsNavId;
	readonly titleKey: string;
	readonly icon: LucideIcon;
	/**
	 * One line for the tablet/phone list: the section's current value where
	 * the restaurant document already has it, otherwise a fixed hint.
	 */
	readonly summary: (restaurant: Doc<"restaurants">, t: TFunction) => string;
	readonly isVisible: (access: SettingsNavAccess) => boolean;
}

export interface SettingsNavGroup {
	readonly id: string;
	readonly titleKey: string;
	readonly entries: readonly SettingsNavEntry[];
}

const always = () => true;
const notSet = (t: TFunction) => t(RestaurantsKeys.SETTINGS_NAV_NOT_SET);
const orNotSet = (value: string | undefined, t: TFunction) => (value?.trim() ? value : notSet(t));

const N = RESTAURANT_SETTINGS_NAV;

/**
 * The settings page's information architecture, decided in the settings
 * grilling (prototype: proto/restaurant-settings-layout). Groups read in the
 * order a new restaurant is set up: what it is, what diners see, how it runs,
 * the business paperwork.
 */
export const SETTINGS_NAV_GROUPS: readonly SettingsNavGroup[] = [
	{
		id: "restaurant",
		titleKey: RestaurantsKeys.SETTINGS_NAV_GROUP_RESTAURANT,
		entries: [
			{
				id: N.GENERAL,
				titleKey: RestaurantsKeys.SETTINGS_NAV_GENERAL,
				icon: Store,
				summary: (r) => `${r.name} · /r/${r.slug}`,
				isVisible: always,
			},
			{
				id: N.LOCATION,
				titleKey: RestaurantsKeys.SETTINGS_NAV_LOCATION,
				icon: MapPin,
				summary: (r, t) =>
					r.latitude != null && r.longitude != null
						? t(RestaurantsKeys.SETTINGS_NAV_LOCATION_SUMMARY, {
								radius: r.geofenceRadiusMeters ?? "—",
								code: r.geofenceBypassCode ?? "—",
							})
						: notSet(t),
				isVisible: always,
			},
			{
				id: N.HOURS,
				titleKey: RestaurantsKeys.SETTINGS_NAV_HOURS,
				icon: Clock,
				summary: (r, t) => {
					const hours = r.openTime && r.closeTime ? `${r.openTime}–${r.closeTime}` : notSet(t);
					return r.timezone ? `${hours} · ${r.timezone}` : hours;
				},
				isVisible: always,
			},
		],
	},
	{
		id: "publicPage",
		titleKey: RestaurantsKeys.SETTINGS_NAV_GROUP_PUBLIC_PAGE,
		entries: [
			{
				id: N.PUBLIC_PROFILE,
				titleKey: RestaurantsKeys.SETTINGS_NAV_PUBLIC_PROFILE,
				icon: Globe,
				summary: (r, t) =>
					[r.phone, r.supportEmail].filter((v) => v?.trim()).join(" · ") || notSet(t),
				isVisible: always,
			},
			{
				id: N.BRANDING,
				titleKey: RestaurantsKeys.SETTINGS_NAV_BRANDING,
				icon: Palette,
				summary: (r, t) => orNotSet(r.brandingColor, t),
				isVisible: always,
			},
		],
	},
	{
		id: "operations",
		titleKey: RestaurantsKeys.SETTINGS_NAV_GROUP_OPERATIONS,
		entries: [
			{
				id: N.ORDERS,
				titleKey: RestaurantsKeys.SETTINGS_NAV_ORDERS,
				icon: ReceiptText,
				summary: (r, t) =>
					t(
						r.releaseCashOrdersImmediately
							? RestaurantsKeys.SETTINGS_NAV_ORDERS_RELEASE
							: RestaurantsKeys.SETTINGS_NAV_ORDERS_HOLD
					),
				isVisible: always,
			},
			{
				id: N.WHATSAPP,
				titleKey: RestaurantsKeys.SETTINGS_NAV_WHATSAPP,
				icon: MessageCircle,
				summary: (_r, t) => t(RestaurantsKeys.SETTINGS_NAV_WHATSAPP_HINT),
				isVisible: always,
			},
			{
				id: N.TABLES,
				titleKey: RestaurantsKeys.SETTINGS_NAV_TABLES,
				icon: LayoutGrid,
				summary: (_r, t) => t(RestaurantsKeys.SETTINGS_NAV_TABLES_HINT),
				isVisible: (a) => a.canManageTables,
			},
		],
	},
	{
		id: "business",
		titleKey: RestaurantsKeys.SETTINGS_NAV_GROUP_BUSINESS,
		entries: [
			{
				id: N.TAX,
				titleKey: RestaurantsKeys.SETTINGS_NAV_TAX,
				icon: FileText,
				summary: (r, t) => orNotSet(r.rfc, t),
				isVisible: always,
			},
			{
				id: N.PAYMENTS,
				titleKey: RestaurantsKeys.SETTINGS_NAV_PAYMENTS,
				icon: CreditCard,
				summary: (_r, t) => t(RestaurantsKeys.SETTINGS_NAV_PAYMENTS_HINT),
				isVisible: (a) => a.isFullAccess && a.canActOnStripe,
			},
			{
				id: N.MANAGERS,
				titleKey: RestaurantsKeys.SETTINGS_NAV_MANAGERS,
				icon: Users,
				summary: (_r, t) => t(RestaurantsKeys.SETTINGS_NAV_MANAGERS_HINT),
				isVisible: (a) => a.isFullAccess,
			},
			{
				// Moving a restaurant between organizations is admin-only on the
				// backend (`restaurants.update` rejects everyone else).
				id: N.ORGANIZATION,
				titleKey: RestaurantsKeys.SETTINGS_NAV_ORGANIZATION,
				icon: Building2,
				summary: (_r, t) => t(RestaurantsKeys.SETTINGS_NAV_ORGANIZATION_HINT),
				isVisible: (a) => a.isFullAccess && a.isAdmin,
			},
		],
	},
];

/** The groups with only the entries this viewer can see; empty groups dropped. */
export function visibleSettingsNav(access: SettingsNavAccess): SettingsNavGroup[] {
	return SETTINGS_NAV_GROUPS.map((g) => ({
		...g,
		entries: g.entries.filter((e) => e.isVisible(access)),
	})).filter((g) => g.entries.length > 0);
}
