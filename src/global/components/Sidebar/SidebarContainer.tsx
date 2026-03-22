import { useToggleSidebar } from "./hooks";

export function SidebarContainer({ children }: Readonly<{ children: React.ReactNode }>) {
	const { isExpanded } = useToggleSidebar();

	return (
		<aside
			className={`h-full flex flex-col transition-all duration-300 ease-in-out ${
				isExpanded ? "w-60" : "w-16"
			}`}
			style={{
				backgroundColor: "var(--bg-secondary)",
				color: "var(--text-secondary)",
				borderRight: "1px solid var(--border-default)",
			}}
		>
			{children}
		</aside>
	);
}
