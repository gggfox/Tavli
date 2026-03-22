import { SidebarKeys } from "@/global/i18n";
import {
	Bell,
	Boxes,
	Clock,
	Gavel,
	History,
	Home,
	LineChart,
	MessageSquare,
	Receipt,
	Settings,
	ShoppingCart,
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
		type: "group",
		translationKey: SidebarKeys.LIVE_AUCTIONS,
		icon: <Gavel size={18} className="shrink-0" />,
		to: "/live-auctions",
		subLinks: [
			{
				translationKey: SidebarKeys.MY_ACTIVE_BIDS,
				icon: <Bell size={18} className="shrink-0" />,
				to: "/my-active-bids",
			},
		],
	},
	{
		type: "group",
		translationKey: SidebarKeys.E_SHOP,
		icon: <ShoppingCart size={18} className="shrink-0" />,
		to: "/e-shop",
		subLinks: [
			{
				translationKey: SidebarKeys.PURCHASE_HISTORY,
				icon: <History size={18} className="shrink-0" />,
				to: "/purchase-history",
			},
		],
	},
	{
		type: "link",
		translationKey: SidebarKeys.ANALYTICS,
		icon: <LineChart size={18} className="shrink-0" />,
		to: "/analytics",
	},
	{
		type: "group",
		translationKey: SidebarKeys.LIVE_RFQS,
		icon: <MessageSquare size={18} className="shrink-0" />,
		to: "/live-rfqs",
		subLinks: [
			{
				translationKey: SidebarKeys.CREATE_RFQ,
				to: "/live-rfqs/create",
			},
		],
	},
	{
		type: "group",
		translationKey: SidebarKeys.ALERTS,
		icon: <Bell size={18} className="shrink-0" />,
		to: "/alerts",
		subLinks: [
			{
				translationKey: SidebarKeys.CREATE_MATERIAL_ALERT,
				to: "/alerts/create-material",
			},
			{
				translationKey: SidebarKeys.CREATE_PRICE_ALERT,
				to: "/alerts/create-price",
			},
		],
	},
	{
		type: "group",
		translationKey: SidebarKeys.SALES_HISTORY,
		icon: <Receipt size={18} className="shrink-0" />,
		to: "/sales-history",
		subLinks: [
			{
				translationKey: SidebarKeys.LIVE_SALES,
				to: "/sales-history/live",
			},
		],
	},
	{
		type: "link",
		translationKey: SidebarKeys.PENDING_MATERIALS,
		icon: <Clock size={18} className="shrink-0" />,
		to: "/pending-materials",
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
				translationKey: SidebarKeys.ADMIN_MATERIALS,
				icon: <Boxes size={18} className="shrink-0" />,
				to: "/admin/materials",
			},
		],
	},
];
