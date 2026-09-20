import { NotificationBell } from "@/features/notifications";
import { SidebarKeys } from "@/global/i18n/keys/sidebar";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToggleSidebar } from "./hooks";

/**
 * The staff header: the top row of the sidebar, and the only chrome present on
 * every restaurant admin page. Diner pages (`/r/*`) render no sidebar at all, so
 * this row is also the line between the staff surface and the diner one — which
 * is why the manager's notification bell (TAVLI-111) lives here.
 *
 * Collapsed, the controls stack rather than squeeze: two 30px icon buttons do
 * not fit across a 64px rail, and the unread badge is the one thing that has to
 * stay visible whether or not the sidebar is expanded. They live in their own
 * group so the row still right-aligns when the bell renders nothing (signed out).
 */
export function LogoSection() {
	const { t } = useTranslation();
	const { toggleSidebar, isExpanded } = useToggleSidebar();

	const ToggleIcon = isExpanded ? PanelLeftClose : PanelLeftOpen;
	return (
		<div
			className={`${`flex items-center transition-all duration-300 ease-in-out ${
				isExpanded ? "h-12 px-3" : "justify-center py-2"
			}`} border-b border-border`}
		>
			{isExpanded && (
				<span className="font-semibold text-sm tracking-tight text-foreground">
					{t(SidebarKeys.BRAND_NAME)}
				</span>
			)}
			<div
				className={
					isExpanded ? "ml-auto flex items-center gap-1" : "flex flex-col items-center gap-1"
				}
			>
				<NotificationBell />
				<button
					onClick={toggleSidebar}
					className="p-1.5 rounded-md hover-icon transition-transform duration-300 ease-in-out"
					aria-label={isExpanded ? t(SidebarKeys.COLLAPSE_SIDEBAR) : t(SidebarKeys.EXPAND_SIDEBAR)}
				>
					<ToggleIcon size={18} />
				</button>
			</div>
		</div>
	);
}
