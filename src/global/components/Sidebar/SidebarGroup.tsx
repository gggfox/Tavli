import { SidebarKey } from "@/global/i18n";
import { Link, LinkProps } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { SidebarLink } from "./SidebarLink";

export type SidebarGroupProps = Readonly<{
	isExpanded: boolean;
	main: {
		translationKey: SidebarKey;
		icon: React.ReactNode;
		to: LinkProps["to"];
	};
	subLinks: Array<{
		translationKey: SidebarKey;
		icon?: React.ReactNode;
		to: LinkProps["to"];
	}>;
}>;

const navLinkClass = (isActive: boolean, isExpanded: boolean) =>
	`flex items-center gap-3 rounded-lg transition-all duration-200 ${
		isExpanded ? "px-3 py-2" : "px-2 py-2 justify-center"
	} ${isActive ? "bg-active" : "hover:bg-hover"}`;

export function SidebarGroup({ isExpanded, main, subLinks }: SidebarGroupProps) {
	const { t } = useTranslation();
	const [groupExpanded, setGroupExpanded] = useState<boolean>(false);

	const toggleGroup = useCallback(() => {
		setGroupExpanded((prev) => !prev);
	}, []);

	const ChevronIcon = groupExpanded ? ChevronDown : ChevronRight;

	return (
		<div className="relative">
			<div className="flex items-center pr-1 text-muted-foreground">
				<Link
					to={main.to}
					className={`flex-1 ${navLinkClass(false, isExpanded)}`}
					activeProps={{ className: `flex-1 ${navLinkClass(true, isExpanded)}` }}
					title={isExpanded ? undefined : t(main.translationKey)}
					
				>
					{main.icon}
					{isExpanded && <span className="text-sm truncate">{t(main.translationKey)}</span>}
				</Link>
				{isExpanded && (
					<button
						className="p-1.5 rounded-md hover-icon transition-all duration-300 ease-in-out"
						onClick={toggleGroup}
					>
						<ChevronIcon size={14} />
					</button>
				)}
			</div>

			{groupExpanded && isExpanded && (
				<div
					className="ml-4 mt-1 space-y-0.5 pl-2 border-l border-border"
					
				>
					{subLinks.map((child) => (
						<SidebarLink
							key={child.translationKey}
							isExpanded={isExpanded}
							translationKey={child.translationKey}
							icon={child.icon || <span className="w-[18px]" />}
							to={child.to}
						/>
					))}
				</div>
			)}
		</div>
	);
}
