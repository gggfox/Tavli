import { useToggleSidebar } from "./hooks";
import { RenderSidebarItem } from "./RenderSidebarItem";
import { SidebarItem } from "./SidebarLink";

export function SidebarItemsList({
	list,
	pathname,
}: Readonly<{ list: SidebarItem[]; pathname: string }>) {
	const { isExpanded } = useToggleSidebar();

	return (
		<nav className="flex-1 p-2 overflow-y-auto overflow-x-hidden space-y-0.5">
			{list.map((item: SidebarItem) => {
				return (
					<RenderSidebarItem
						key={item.translationKey}
						item={item}
						isExpanded={isExpanded}
						pathname={pathname}
					/>
				);
			})}
		</nav>
	);
}
