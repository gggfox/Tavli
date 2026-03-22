import { SettingsModal } from "@/features";
import { SidebarKeys } from "@/global/i18n/locales";
import { Settings } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useToggleSidebar } from "./hooks/useSidebarStore.ts";

export function SettingsButton() {
	const { t } = useTranslation();
	const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
	const { isExpanded } = useToggleSidebar();

	return (
		<div className="p-2" style={{ borderTop: "1px solid var(--border-default)" }}>
			<button
				onClick={() => setIsSettingsModalOpen(true)}
				className={`w-full flex items-center gap-3 rounded-lg hover-secondary ${
					isExpanded ? "px-3 py-2" : "px-2 py-2 justify-center"
				}`}
				title={isExpanded ? undefined : t(SidebarKeys.SETTINGS)}
			>
				<Settings size={18} className="shrink-0" />
				{isExpanded && <span className="text-sm truncate">{t(SidebarKeys.SETTINGS)}</span>}
			</button>
			<SettingsModal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} />
		</div>
	);
}
