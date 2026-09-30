import { OrderingKeys } from "@/global/i18n";
import { SignInButton } from "@clerk/tanstack-react-start";
import { LogIn } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * The order bar for a signed-out diner: the menu is open to everyone, and the
 * account is asked for at the moment it is needed — placing an order.
 *
 * Redirect mode with no explicit URL on purpose: Clerk returns to
 * `window.location.href` by default, so the diner lands back on this same
 * menu (same restaurant, same language) and the layout opens their Session
 * exactly as it does for anyone who arrives signed in.
 */
export function SignInToOrder() {
	const { t } = useTranslation();
	return (
		<SignInButton mode="redirect">
			<button
				type="button"
				className="w-full max-w-sm mx-auto flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium hover-btn-primary"
			>
				<LogIn size={16} />
				{t(OrderingKeys.SESSION_SIGN_IN_REQUIRED)}
			</button>
		</SignInButton>
	);
}
