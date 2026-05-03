import { SidebarKey } from "@/global/i18n";
import { LinkProps } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSidebarGroups } from "./hooks";
import { SidebarLink } from "./SidebarLink";

export type SidebarGroupProps = Readonly<{
	isExpanded: boolean;
	pathname: string;
	main: {
		translationKey: SidebarKey;
		icon: React.ReactNode;
	};
	subLinks: Array<{
		translationKey: SidebarKey;
		icon?: React.ReactNode;
		to: LinkProps["to"];
	}>;
}>;

const navRowClass = (isActive: boolean, isExpanded: boolean) =>
	`flex items-center gap-3 rounded-lg transition-all duration-200 w-full text-left ${
		isExpanded ? "px-3 py-2" : "px-2 py-2 justify-center"
	} ${isActive ? "bg-active" : "hover:bg-hover"}`;

function pathnameMatchesGroupRoute(pathname: string, route: string): boolean {
	if (pathname === route) return true;
	return pathname.startsWith(`${route}/`);
}

function isPathInsideGroup(
	pathname: string,
	subLinks: ReadonlyArray<{ to: LinkProps["to"] }>
): boolean {
	return subLinks.some((s) => pathnameMatchesGroupRoute(pathname, String(s.to)));
}

export function SidebarGroup({ isExpanded, pathname, main, subLinks }: SidebarGroupProps) {
	const { t } = useTranslation();
	const { isOpen, setGroupExpanded, toggleGroup } = useSidebarGroups();
	const groupKey = main.translationKey;

	const routeActive = useMemo(
		() => isPathInsideGroup(pathname, subLinks),
		[pathname, subLinks]
	);

	const groupExpanded = isOpen(groupKey);

	// Auto-open on entering the group's route (e.g. deep link to a
	// sub-page or first navigation into a sublink). The ref starts at
	// `false` so the very first mount with `routeActive === true`
	// triggers the auto-open. We deliberately do not auto-close when
	// leaving so groups stay open until the user explicitly closes
	// them.
	const prevRouteActive = useRef(false);
	useEffect(() => {
		if (routeActive && !prevRouteActive.current) {
			setGroupExpanded(groupKey, true);
		}
		prevRouteActive.current = routeActive;
	}, [routeActive, groupKey, setGroupExpanded]);

	const toggleGroupHandler = useCallback(() => {
		// In rail mode (sidebar collapsed) the chevron and sublinks are
		// hidden, so toggling has no visible effect. Skip the toggle to
		// avoid silently mutating the persisted preference.
		if (!isExpanded) return;
		toggleGroup(groupKey);
	}, [isExpanded, toggleGroup, groupKey]);

	const ChevronIcon = groupExpanded ? ChevronDown : ChevronRight;

	return (
		<div className="relative">
			<button
				type="button"
				onClick={toggleGroupHandler}
				className={`${navRowClass(routeActive, isExpanded)} text-muted-foreground`}
				title={isExpanded ? undefined : t(main.translationKey)}
				aria-expanded={groupExpanded}
			>
				{main.icon}
				{isExpanded && (
					<>
						<span className="text-sm truncate flex-1">{t(main.translationKey)}</span>
						<ChevronIcon size={14} className="shrink-0" />
					</>
				)}
			</button>

			{groupExpanded && isExpanded && (
				<div className="ml-4 mt-1 space-y-0.5 pl-2 border-l border-border">
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
