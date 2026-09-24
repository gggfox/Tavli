import { OrganizationSwitcher } from "@/features/restaurants/components/OrganizationSwitcher";
import { RestaurantSwitcher } from "@/features/restaurants/components/RestaurantSwitcher";
import { AuthSections } from "./AuthSections";
import { LogoSection } from "./LogoSection";
import "./Sidebar.css";
import { SidebarContainer } from "./SidebarContainer";
import { SidebarItemsList } from "./SidebarItemsList";
import { useEffect } from "react";
import {
	useSidebarGroupsHydration,
	useSidebarHydration,
	useSidebarItems,
	useSidebarStore,
} from "./hooks";

export function Sidebar({ pathname }: Readonly<{ pathname: string }>) {
	useSidebarHydration();
	useSidebarGroupsHydration();
	const { filteredSidebarItems } = useSidebarItems();
	const setOverlayOpen = useSidebarStore((state) => state.setOverlayOpen);

	// Following a link from the phone drawer or the expanded tablet rail
	// should land on the page, not leave the menu covering it.
	useEffect(() => {
		setOverlayOpen(false);
	}, [pathname, setOverlayOpen]);

	return (
		<SidebarContainer>
			<LogoSection />
			{/* Broadest scope first: organization narrows the restaurant list below it. */}
			<OrganizationSwitcher />
			<RestaurantSwitcher />
			<SidebarItemsList list={filteredSidebarItems} pathname={pathname} />
			<AuthSections />
		</SidebarContainer>
	);
}
