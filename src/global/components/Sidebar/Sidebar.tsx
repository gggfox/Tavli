import { AuthSections } from "./AuthSections";
import { LogoSection } from "./LogoSection";
import "./Sidebar.css";
import { SidebarContainer } from "./SidebarContainer";
import { SidebarItemsList } from "./SidebarItemsList";
import { useSidebarHydration, useSidebarItems } from "./hooks";

export function Sidebar() {
	useSidebarHydration();
	const { filteredSidebarItems } = useSidebarItems();

	return (
		<SidebarContainer>
			<LogoSection />
			<SidebarItemsList list={filteredSidebarItems} />
			<AuthSections />
		</SidebarContainer>
	);
}
