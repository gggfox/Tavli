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
			<div
				className={`flex items-center gap-3 p-2 rounded-lg transition-colors group hover:bg-(--bg-hover) ${
					isExpanded ? "flex-row" : "flex-col justify-center"
				}`}
			>
				<button
					className="relative"
					title={isExpanded ? undefined : `${displayName} - ${settingsLabel}`}
					onClick={openSettings}
					aria-label={settingsLabel}
				>
					<Avatar
						src={user.imageUrl}
						alt={displayName}
						fallback={getAvatarFallback(user.firstName, email)}
						size="md"
						className="transition-all"
					/>
					{!isExpanded && (
						<div
							className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity text-primary"
							
						>
							<Settings size={12} />
						</div>
					)}
				</button>
				{isExpanded && (
					<div className="flex-1 min-w-0">
						<p className="text-sm font-medium truncate text-foreground" >
							{user.firstName} {user.lastName}
						</p>
						<p className="text-xs truncate text-faint-foreground" >
							{email}
						</p>
					</div>
				)}
				{isExpanded && (
					<button
						onClick={openSettings}
						className="p-1.5 rounded-md transition-all hover-icon opacity-0 group-hover:opacity-100"
						aria-label={settingsLabel}
						title={settingsLabel}
					>
						<Settings size={16} />
					</button>
				)}
			</div>
			<SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
		</div>
	);
}
