import { SidebarKey } from "@/global/i18n";
import { Link, LinkProps } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export type SidebarLinkProps = Readonly<{
	isExpanded: boolean;
	translationKey: SidebarKey;
	icon: React.ReactNode;
	to: LinkProps["to"];
	search?: LinkProps["search"];
	/** Overrides the router's own active match — set when the link covers several routes. */
	isActive?: boolean;
}>;

export type SidebarLinkConfig = {
	type: "link";
	translationKey: SidebarKey;
	icon: React.ReactNode;
	to: LinkProps["to"];
	search?: LinkProps["search"];
	/** Path prefixes that also light this link up (one entry, several pages behind tabs). */
	activePaths?: readonly string[];
};

export type SidebarGroupConfig = {
	type: "group";
	translationKey: SidebarKey;
	icon: React.ReactNode;
	subLinks: Array<{
		translationKey: SidebarKey;
		icon?: React.ReactNode;
		to: LinkProps["to"];
	}>;
};

export type SidebarItem = SidebarLinkConfig | SidebarGroupConfig;

const navLinkClass = (isActive: boolean, isExpanded: boolean) =>
	`flex items-center gap-3 rounded-lg transition-all duration-200 ${
		isExpanded ? "px-3 py-2" : "px-2 py-2 justify-center"
	} ${isActive ? "bg-active" : "hover:bg-hover"}`;

export function SidebarLink({
	isExpanded,
	icon,
	translationKey,
	to,
	search,
	isActive,
}: SidebarLinkProps) {
	const { t } = useTranslation();
	return (
		<Link
			to={to}
			{...(search === undefined ? {} : { search })}
			className={
				isActive
					? navLinkClass(true, isExpanded)
					: `${navLinkClass(false, isExpanded)} text-muted-foreground`
			}
			activeProps={
				isActive === undefined ? { className: navLinkClass(true, isExpanded) } : undefined
			}
			title={isExpanded ? undefined : t(translationKey)}
		>
			{icon}
			{isExpanded && <span className="text-sm truncate">{t(translationKey)}</span>}
		</Link>
	);
}
