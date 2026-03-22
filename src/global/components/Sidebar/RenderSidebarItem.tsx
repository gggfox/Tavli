import { SidebarGroup } from "./SidebarGroup";
import { SidebarItem, SidebarLink } from "./SidebarLink";

export function RenderSidebarItem({
	item,
	isExpanded,
}: Readonly<{ item: SidebarItem; isExpanded: boolean }>) {
	if (item.type === "link") {
		return (
			<SidebarLink
				key={item.translationKey}
				isExpanded={isExpanded}
				translationKey={item.translationKey}
				icon={item.icon}
				to={item.to}
			/>
		);
	}
	return (
		<SidebarGroup
			key={`${item.translationKey}`}
			isExpanded={isExpanded}
			main={item}
			subLinks={item.subLinks}
		/>
	);
}
