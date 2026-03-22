import { SidebarKeys } from "@/global/i18n";
import { Config } from "@/global/utils/config";
import { useTranslation } from "react-i18next";
import { SidebarAuthSection } from "./SidebarAuthSection";
import { SidebarUserSection } from "./SidebarUserSection";
import { useToggleSidebar } from "./hooks";

export function AuthSections() {
	const { t } = useTranslation();
	const { isExpanded } = useToggleSidebar();

	const hasAuth = Config.instance.hasWorkOSConfig;
	return (
		<>
			{hasAuth && (
				<>
					<SidebarUserSection isExpanded={isExpanded} />
					<SidebarAuthSection isExpanded={isExpanded} />
				</>
			)}

			{!hasAuth && isExpanded && (
				<div className="p-3" style={{ borderTop: "1px solid var(--border-default)" }}>
					<span className="text-xs" style={{ color: "var(--text-muted)" }}>
						{t(SidebarKeys.AUTH_NOT_CONFIGURED)}
					</span>
				</div>
			)}
		</>
	);
}
