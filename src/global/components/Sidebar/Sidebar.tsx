import { RestaurantSwitcher } from "@/features/restaurants/components/RestaurantSwitcher";
import { AuthSections } from "./AuthSections";
import { LogoSection } from "./LogoSection";
import "./Sidebar.css";
import { SidebarContainer } from "./SidebarContainer";
import { SidebarItemsList } from "./SidebarItemsList";
import { useSidebarHydration, useSidebarItems } from "./hooks";

export function Sidebar({ pathname }: Readonly<{ pathname: string }>) {
	useSidebarHydration();
	const { filteredSidebarItems } = useSidebarItems();

	return (
		<SidebarContainer>
			<LogoSection />
			<RestaurantSwitcher />
			<SidebarItemsList list={filteredSidebarItems} pathname={pathname} />
			<AuthSections />
		</SidebarContainer>
	);
}
