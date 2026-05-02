import { SettingsModal } from "@/features";
import { SidebarKeys } from "@/global/i18n";
import { useUser } from "@clerk/tanstack-react-start";
import { Settings } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, getAvatarFallback } from "../Avatar";

interface SidebarUserSectionProps {
	isExpanded: boolean;
}

/**
 * User section in sidebar that displays user info and a button to open the
 * settings modal. Adapts to collapsed/expanded sidebar state. Sign out has
 * moved into the settings modal itself.
 */
export function SidebarUserSection({ isExpanded }: Readonly<SidebarUserSectionProps>) {
	const { t } = useTranslation();
	const { user } = useUser();
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);

	if (!user) return null;

	const displayName = user.firstName || user.primaryEmailAddress?.emailAddress || "User";
	const email = user.primaryEmailAddress?.emailAddress ?? "";
	const settingsLabel = t(SidebarKeys.SETTINGS);

	const openSettings = () => setIsSettingsOpen(true);

	return (
		<div className="p-2 border-t border-border" >
			<button
				type="button"
				onClick={openSettings}
				aria-label={settingsLabel}
				title={isExpanded ? settingsLabel : `${displayName} - ${settingsLabel}`}
				className={`group w-full flex items-center gap-3 p-2 rounded-lg transition-colors hover:bg-(--bg-hover) ${
					isExpanded ? "flex-row text-left" : "flex-col justify-center"
				}`}
			>
				<span className="relative shrink-0">
					<Avatar
						src={user.imageUrl}
						alt={displayName}
						fallback={getAvatarFallback(user.firstName, email)}
						size="md"
						className="transition-all"
					/>
					{!isExpanded && (
						<span className="absolute -top-1 -right-1 text-primary">
							<Settings size={12} />
						</span>
					)}
				</span>
				{isExpanded && (
					<span className="flex-1 min-w-0">
						<span className="block text-sm font-medium truncate text-foreground">
							{user.firstName} {user.lastName}
						</span>
						<span className="block text-xs truncate text-faint-foreground">
							{email}
						</span>
					</span>
				)}
				{isExpanded && (
					<span className="p-1.5 rounded-md transition-colors text-(--text-tertiary) group-hover:text-(--text-primary)">
						<Settings size={16} />
					</span>
				)}
			</button>
			<SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
		</div>
	);
}
