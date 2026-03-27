import { SidebarKeys } from "@/global/i18n";
import { useClerk, useUser } from "@clerk/tanstack-react-start";
import { LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar, getAvatarFallback } from "../Avatar";

interface SidebarUserSectionProps {
	isExpanded: boolean;
}

/**
 * User section in sidebar that displays user info and sign out button.
 * Adapts to collapsed/expanded sidebar state.
 */
export function SidebarUserSection({ isExpanded }: Readonly<SidebarUserSectionProps>) {
	const { t } = useTranslation();
	const { user } = useUser();
	const { signOut } = useClerk();

	if (!user) return null;

	const displayName = user.firstName || user.primaryEmailAddress?.emailAddress || "User";
	const email = user.primaryEmailAddress?.emailAddress ?? "";

	return (
		<div className="p-2" style={{ borderTop: "1px solid var(--border-default)" }}>
			<div
				className={`flex items-center gap-3 p-2 rounded-lg transition-colors group hover:bg-(--bg-hover) ${
					isExpanded ? "flex-row" : "flex-col justify-center"
				}`}
			>
				<button
					className="relative"
					title={isExpanded ? undefined : `${displayName} - ${t(SidebarKeys.CLICK_TO_SIGN_OUT)}`}
					onClick={() => signOut()}
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
							className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity"
							style={{ color: "var(--btn-primary-bg)" }}
						>
							<LogOut size={12} />
						</div>
					)}
				</button>
				{isExpanded && (
					<div className="flex-1 min-w-0">
						<p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
							{user.firstName} {user.lastName}
						</p>
						<p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
							{email}
						</p>
					</div>
				)}
				{isExpanded && (
					<button
						onClick={() => signOut()}
						className="p-1.5 rounded-md transition-all hover-icon opacity-0 group-hover:opacity-100"
						aria-label={t(SidebarKeys.SIGN_OUT)}
						title={t(SidebarKeys.SIGN_OUT)}
					>
						<LogOut size={16} />
					</button>
				)}
			</div>
		</div>
	);
}
