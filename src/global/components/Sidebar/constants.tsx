import { SidebarKeys } from "@/global/i18n";
import {
	Building2,
	CalendarClock,
	CalendarRange,
	ClipboardList,
	DollarSign,
	Flag,
	LayoutDashboard,
	MessageSquare,
	ListOrdered,
	Mail,
	Settings,
	ShieldCheck,
	Store,
	Users,
	UsersRound,
} from "lucide-react";
import { SidebarItem } from "./SidebarLink";

export const sidebarItems: SidebarItem[] = [
	{
		type: "link",
		translationKey: SidebarKeys.DASHBOARD,
		icon: <LayoutDashboard size={18} className="shrink-0" />,
		to: "/dashboard",
	},
	{
		type: "link",
		translationKey: SidebarKeys.RESTAURANTS,
		icon: <Store size={18} className="shrink-0" />,
		to: "/admin/restaurants",
	},
	{
		type: "link",
		translationKey: SidebarKeys.MENUS,
		icon: <ClipboardList size={18} className="shrink-0" />,
		to: "/admin/menus",
		search: {},
	},

	{
		type: "link",
		translationKey: SidebarKeys.ORDERS,
		icon: <ListOrdered size={18} className="shrink-0" />,
		to: "/admin/orders",
	},
	{
		type: "link",
		translationKey: SidebarKeys.PAYMENTS,
		icon: <DollarSign size={18} className="shrink-0" />,
		to: "/admin/payments",
	},
	{
		type: "link",
		translationKey: SidebarKeys.RESERVATIONS,
		icon: <CalendarClock size={18} className="shrink-0" />,
		to: "/admin/reservations",
	},
	{
		// Staff-visible, so a top-level link rather than a child of the ADMIN
		// group — that group is filtered to platform admins in `useSidebarItems`,
		// and this screen is open to any active staff member of the restaurant.
		type: "link",
		translationKey: SidebarKeys.WHATSAPP,
		icon: <MessageSquare size={18} className="shrink-0" />,
		to: "/admin/whatsapp",
		search: {},
	},
	{
		type: "group",
		translationKey: SidebarKeys.TEAM,
		icon: <UsersRound size={18} className="shrink-0" />,
		subLinks: [
			{
				translationKey: SidebarKeys.TEAM_INVITES,
				icon: <Mail size={18} className="shrink-0" />,
				to: "/admin/team",
			},
			{
				translationKey: SidebarKeys.SCHEDULE,
				icon: <CalendarRange size={18} className="shrink-0" />,
				to: "/admin/schedule",
			},
		],
	},
	{
		type: "group",
		translationKey: SidebarKeys.ADMIN,
		icon: <Settings size={18} className="shrink-0" />,
		subLinks: [
			{
				translationKey: SidebarKeys.ADMIN_USERS,
				icon: <Users size={18} className="shrink-0" />,
				to: "/admin/users",
			},
			{
				translationKey: SidebarKeys.ADMIN_ORGANIZATIONS,
				icon: <Building2 size={18} className="shrink-0" />,
				to: "/admin/organizations",
			},
			{
				translationKey: SidebarKeys.ADMIN_FEATURE_FLAGS,
				icon: <Flag size={18} className="shrink-0" />,
				to: "/admin/feature-flags",
			},
			{
				translationKey: SidebarKeys.ADMIN_WHATSAPP_ALLOWLIST,
				icon: <ShieldCheck size={18} className="shrink-0" />,
				to: "/admin/whatsapp-allowlist",
			},
		],
	},
];
