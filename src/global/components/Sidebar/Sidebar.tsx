import { OrganizationSwitcher } from "@/features/restaurants/components/OrganizationSwitcher";
import { RestaurantSwitcher } from "@/features/restaurants/components/RestaurantSwitcher";
import { AuthSections } from "./AuthSections";
import { LogoSection } from "./LogoSection";
import "./Sidebar.css";
import { SidebarContainer } from "./SidebarContainer";
import { SidebarItemsList } from "./SidebarItemsList";
import { useSidebarGroupsHydration, useSidebarHydration, useSidebarItems } from "./hooks";

export function Sidebar({ pathname }: Readonly<{ pathname: string }>) {
	useSidebarHydration();
	useSidebarGroupsHydration();
	const { filteredSidebarItems } = useSidebarItems();

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
