import { SidebarKeys } from "@/global/i18n";
import {
	Building2,
	ClipboardList,
	DollarSign,
	Home,
	ListOrdered,
	Settings,
	Store,
	Users,
} from "lucide-react";
import { SidebarItem } from "./SidebarLink";

export const sidebarItems: SidebarItem[] = [
	{
		type: "link",
		translationKey: SidebarKeys.HOME,
		icon: <Home size={18} className="shrink-0" />,
		to: "/",
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
		type: "group",
		translationKey: SidebarKeys.ADMIN,
		icon: <Settings size={18} className="shrink-0" />,
		to: "/admin",
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
