import { SidebarKeys } from "@/global/i18n/locales";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToggleSidebar } from "./hooks";

export function LogoSection() {
	const { t } = useTranslation();
	const { toggleSidebar, isExpanded } = useToggleSidebar();

	const ToggleIcon = isExpanded ? PanelLeftClose : PanelLeftOpen;
	return (
		<div
			className={`flex items-center h-12 px-3 transition-all duration-300 ease-in-out ${
				isExpanded ? "" : "justify-center"
			}`}
			style={{ borderBottom: "1px solid var(--border-default)" }}
		>
			{isExpanded && (
				<span
					className="font-semibold text-sm tracking-tight"
					style={{ color: "var(--text-primary)" }}
				>
					{t(SidebarKeys.BRAND_NAME)}
				</span>
			)}
			<button
				onClick={toggleSidebar}
				className={`p-1.5 rounded-md hover-icon transition-transform duration-300 ease-in-out ${
					isExpanded ? "ml-auto" : ""
				}`}
				aria-label={isExpanded ? t(SidebarKeys.COLLAPSE_SIDEBAR) : t(SidebarKeys.EXPAND_SIDEBAR)}
			>
				<ToggleIcon size={18} />
			</button>
		</div>
	);
}
