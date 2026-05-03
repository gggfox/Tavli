import { SidebarGroup } from "./SidebarGroup";
import { SidebarItem, SidebarLink } from "./SidebarLink";

export function RenderSidebarItem({
	item,
	isExpanded,
	pathname,
}: Readonly<{ item: SidebarItem; isExpanded: boolean; pathname: string }>) {
	if (item.type === "link") {
		return (
			<SidebarLink
				key={item.translationKey}
				isExpanded={isExpanded}
				translationKey={item.translationKey}
				icon={item.icon}
				to={item.to}
				search={item.search}
			/>
		);
	}
	return (
		<SidebarGroup
			key={`${item.translationKey}`}
			isExpanded={isExpanded}
			main={{ translationKey: item.translationKey, icon: item.icon }}
			pathname={pathname}
			subLinks={item.subLinks}
		/>
	);
}
