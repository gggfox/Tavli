import { SidebarKeys } from "@/global/i18n";
import { useAuth } from "@workos/authkit-tanstack-react-start/client";
import { LogIn, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";

interface SidebarAuthSectionProps {
	isExpanded: boolean;
}

/**
 * Auth section shown when user is not logged in.
 * Displays sign in/sign up options that adapt to sidebar state.
 */
export function SidebarAuthSection({ isExpanded }: Readonly<SidebarAuthSectionProps>) {
	const { t } = useTranslation();
	const { user, loading } = useAuth();

	// Don't show if loading or if user is logged in
	if (loading || user) return null;

	return (
		<div className="p-2" style={{ borderTop: "1px solid var(--border-default)" }}>
			<div className={`space-y-1 ${isExpanded ? "" : "flex flex-col items-center"}`}>
				<a
					href="/api/auth/signin"
					className={`flex items-center gap-3 rounded-lg text-sm hover-secondary transition-all duration-300 ${
						isExpanded ? "px-3 py-2" : "px-2 py-2 justify-center"
					}`}
					title={isExpanded ? undefined : t(SidebarKeys.SIGN_IN)}
				>
					<LogIn size={18} className="shrink-0" />
					{isExpanded && <span>{t(SidebarKeys.SIGN_IN)}</span>}
				</a>
				<a
					href="/api/auth/signup"
					className={`flex items-center gap-2 rounded-lg text-sm font-medium hover-btn-primary transition-all duration-300 ${
						isExpanded ? "px-3 py-2" : "px-2 py-2 justify-center"
					}`}
					title={isExpanded ? undefined : t(SidebarKeys.SIGN_UP)}
				>
					<UserPlus size={18} className="shrink-0" />
					{isExpanded && <span>{t(SidebarKeys.SIGN_UP)}</span>}
				</a>
			</div>
		</div>
	);
}
