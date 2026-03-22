import { useEffect, useState } from "react";
import { AuthSections } from "./AuthSections";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { LogoSection } from "./LogoSection";
import { SidebarContainer } from "./SidebarContainer";
import { SidebarItemsList } from "./SidebarItemsList";
import { SettingsButton } from "./SidebarSettingsButton";
import { useSidebarItems } from "./hooks";

export function Sidebar() {
	const [isMounted, setIsMounted] = useState(false);
	const { filteredSidebarItems } = useSidebarItems({ isMounted });

	useEffect(() => {
		setIsMounted(true);
	}, []);

	if (!isMounted) {
		return <LoadingSkeleton />;
	}

	return (
		<SidebarContainer>
			<LogoSection />
			<SidebarItemsList list={filteredSidebarItems} />
			<SettingsButton />
			<AuthSections />
		</SidebarContainer>
	);
}
