import { SidebarKeys } from "@/global/i18n";
import {
	ClipboardList,
	Home,
	LayoutGrid,
	ListOrdered,
	Settings,
	Store,
	Users,
	UtensilsCrossed,
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
		type: "group",
		translationKey: SidebarKeys.RESTAURANT,
		icon: <UtensilsCrossed size={18} className="shrink-0" />,
		to: "/admin/restaurant",
		subLinks: [
			{
				translationKey: SidebarKeys.TABLES,
				to: "/admin/restaurant/tables",
			},
		],
	},
	{
		type: "link",
		translationKey: SidebarKeys.MENUS,
		icon: <ClipboardList size={18} className="shrink-0" />,
		to: "/admin/menus",
	},
	{
		type: "link",
		translationKey: SidebarKeys.OPTIONS,
		icon: <LayoutGrid size={18} className="shrink-0" />,
		to: "/admin/options",
	},
	{
		type: "link",
		translationKey: SidebarKeys.ORDERS,
		icon: <ListOrdered size={18} className="shrink-0" />,
		to: "/admin/orders",
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
		],
	},
];
