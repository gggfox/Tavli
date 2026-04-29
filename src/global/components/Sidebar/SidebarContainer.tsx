import { useToggleSidebar } from "./hooks";

export function SidebarContainer({ children }: Readonly<{ children: React.ReactNode }>) {
	const { isExpanded } = useToggleSidebar();

	return (
		<aside
			className={`${`tavli-sidebar-width h-full flex flex-col transition-all duration-300 ease-in-out ${
				isExpanded ? "w-60" : "w-16"
			}`} bg-muted text-muted-foreground border-r border-border`}
		 
		>
			{children}
		</aside>
	);
}
