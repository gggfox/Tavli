import { EmptyState } from "@/global/components/EmptyState";
import { AdminAccessKeys } from "@/global/i18n";
import { SignInButton, useAuth } from "@clerk/tanstack-react-start";
import { LogIn, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * What the staff-only layouts (`/admin`, `/dashboard`) show anyone who may not
 * see them.
 *
 * Signed out is not the same visitor as signed in without a staff role: the
 * first one most likely followed a bookmark or a link from an email and only
 * needs to sign in, so they get a way in rather than a dead end. Redirect mode
 * with no explicit URL brings them back to the page they asked for (Clerk
 * returns to `window.location.href`). Only a signed-in visitor who still has no
 * staff role is told access is denied.
 *
 * Clerk's `isSignedIn` decides, not Convex's `isAuthenticated`: a Clerk
 * session whose Convex token is failing is still signed in, and sending that
 * person to sign in again would loop.
 */
export function StaffAccessDeniedState() {
	const { t } = useTranslation();
	const { isSignedIn } = useAuth();

	if (isSignedIn === false) {
		return (
			<EmptyState
				icon={LogIn}
				title={t(AdminAccessKeys.SIGN_IN_TITLE)}
				description={t(AdminAccessKeys.SIGN_IN_DESCRIPTION)}
				className="w-full max-w-md px-6"
				action={
					<SignInButton mode="redirect">
						<button
							type="button"
							className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium hover-btn-primary"
						>
							<LogIn size={16} aria-hidden />
							{t(AdminAccessKeys.SIGN_IN_BUTTON)}
						</button>
					</SignInButton>
				}
			/>
		);
	}

	return (
		<EmptyState
			icon={ShieldAlert}
			title={t(AdminAccessKeys.ACCESS_DENIED_TITLE)}
			description={t(AdminAccessKeys.ACCESS_DENIED_DESCRIPTION)}
			className="w-full max-w-md px-6"
		/>
	);
}
