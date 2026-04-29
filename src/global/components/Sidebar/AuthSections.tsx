import { SidebarKeys } from "@/global/i18n";
import { config } from "@/global/utils/config";
import { useTranslation } from "react-i18next";
import { SidebarAuthSection } from "./SidebarAuthSection";
import { SidebarUserSection } from "./SidebarUserSection";
import { useToggleSidebar } from "./hooks";

export function AuthSections() {
	const { t } = useTranslation();
	const { isExpanded } = useToggleSidebar();

	const hasAuth = config.hasAuthConfig;
	return (
		<>
			{hasAuth && (
				<>
					<SidebarUserSection isExpanded={isExpanded} />
					<SidebarAuthSection isExpanded={isExpanded} />
				</>
			)}

			{!hasAuth && isExpanded && (
				<div className="p-3 border-t border-border" >
					<span className="text-xs text-faint-foreground" >
						{t(SidebarKeys.AUTH_NOT_CONFIGURED)}
					</span>
				</div>
			)}
		</>
	);
}
