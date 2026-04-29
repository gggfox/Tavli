import { SidebarKey } from "@/global/i18n";
import { Link, LinkProps } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export type SidebarLinkProps = Readonly<{
	isExpanded: boolean;
	translationKey: SidebarKey;
	icon: React.ReactNode;
	to: LinkProps["to"];
}>;

export type SidebarLinkConfig = {
	type: "link";
	translationKey: SidebarKey;
	icon: React.ReactNode;
	to: LinkProps["to"];
};

export type SidebarGroupConfig = {
	type: "group";
	translationKey: SidebarKey;
	icon: React.ReactNode;
	to: LinkProps["to"];
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

export function SidebarLink({ isExpanded, icon, translationKey, to }: SidebarLinkProps) {
	const { t } = useTranslation();
	return (
		<Link
			to={to}
			className={`${navLinkClass(false, isExpanded)} text-muted-foreground`}
			activeProps={{ className: navLinkClass(true, isExpanded) }}
			title={isExpanded ? undefined : t(translationKey)}
		 
		>
			{icon}
			{isExpanded && <span className="text-sm truncate">{t(translationKey)}</span>}
		</Link>
	);
}
