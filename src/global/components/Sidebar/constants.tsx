import { SidebarKeys } from "@/global/i18n";
import {
	Building2,
	CalendarClock,
	CalendarRange,
	ClipboardList,
	Clock,
	Coins,
	DollarSign,
	LineChart,
	ListOrdered,
	Mail,
	Settings,
	Store,
	Users,
	UsersRound,
} from "lucide-react";
import { SidebarItem } from "./SidebarLink";

export const sidebarItems: SidebarItem[] = [
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
			{
				translationKey: SidebarKeys.ATTENDANCE,
				icon: <Clock size={18} className="shrink-0" />,
				to: "/admin/attendance",
			},
			{
				translationKey: SidebarKeys.TIPS,
				icon: <Coins size={18} className="shrink-0" />,
				to: "/admin/tips",
			},
			{
				translationKey: SidebarKeys.PERFORMANCE,
				icon: <LineChart size={18} className="shrink-0" />,
				to: "/admin/performance",
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
		],
	},
];
