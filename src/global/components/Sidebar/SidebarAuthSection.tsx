import { SidebarKeys } from "@/global/i18n";
import { SignInButton, SignUpButton, useAuth } from "@clerk/tanstack-react-start";
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
	const { isLoaded, isSignedIn } = useAuth();

	if (!isLoaded || isSignedIn) return null;

	return (
		<div className="p-2 border-t border-border" >
			<div className={`space-y-1 ${isExpanded ? "" : "flex flex-col items-center"}`}>
				<SignInButton mode="redirect">
					<button
						className={`flex items-center gap-3 rounded-lg text-sm hover-secondary transition-all duration-300 w-full ${
							isExpanded ? "px-3 py-2" : "px-2 py-2 justify-center"
						}`}
						title={isExpanded ? undefined : t(SidebarKeys.SIGN_IN)}
					>
						<LogIn size={18} className="shrink-0" />
						{isExpanded && <span>{t(SidebarKeys.SIGN_IN)}</span>}
					</button>
				</SignInButton>
				<SignUpButton mode="redirect">
					<button
						className={`flex items-center gap-2 rounded-lg text-sm font-medium hover-btn-primary transition-all duration-300 w-full ${
							isExpanded ? "px-3 py-2" : "px-2 py-2 justify-center"
						}`}
						title={isExpanded ? undefined : t(SidebarKeys.SIGN_UP)}
					>
						<UserPlus size={18} className="shrink-0" />
						{isExpanded && <span>{t(SidebarKeys.SIGN_UP)}</span>}
					</button>
				</SignUpButton>
			</div>
		</div>
	);
}
