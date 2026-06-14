import { useIsTabletPortraitViewport } from "@/global/hooks";
import { useToggleSidebar } from "./hooks";

export function SidebarContainer({ children }: Readonly<{ children: React.ReactNode }>) {
	const { isExpanded } = useToggleSidebar();
	const isTabletPortrait = useIsTabletPortraitViewport();
	const expandedWidth = isTabletPortrait ? "w-52" : "w-60";

	return (
		<aside
			className={`${`tavli-sidebar-width h-full min-h-0 flex flex-col overflow-hidden transition-all duration-300 ease-in-out ${
				isExpanded ? expandedWidth : "w-16"
			}`} bg-muted text-muted-foreground border-r border-border`}
		>
			{children}
		</aside>
	);
}
