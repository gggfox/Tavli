import { FeatureCard } from "@/global/components/FeatureCard/FeatureCard.tsx";
import { SidebarKeys, WelcomeKeys } from "@/global/i18n";
import { ClerkLoaded, ClerkLoading, useClerk } from "@clerk/tanstack-react-start";
import { CalendarCheck, LogIn, QrCode, Shield, UserPlus, UtensilsCrossed } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export function WelcomeSection() {
	return (
		<WelcomeSectionContainer>
			<Hero />
			<Features />
			<CallToAction />
		</WelcomeSectionContainer>
	);
}

function WelcomeSectionContainer({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<div className="min-h-full flex flex-col items-center justify-center px-6 py-6 md:py-12 max-w-3xl mx-auto">
			{children}
		</div>
	);
}

function Hero() {
	const { t } = useTranslation();
	return (
		<div className="text-center mb-6 md:mb-12">
			<div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm mb-3 md:mb-6 bg-success-subtle text-success border border-success">
				<UtensilsCrossed size={14} />
				<span>{t(WelcomeKeys.BADGE)}</span>
			</div>
			<h1 className="text-2xl sm:text-3xl md:text-5xl font-bold mb-2 md:mb-4 tracking-tight text-foreground">
				{t(WelcomeKeys.HEADING_PREFIX)}{" "}
				<span className="text-primary">{t(SidebarKeys.BRAND_NAME)}</span>
			</h1>
			<p className="text-sm sm:text-base md:text-lg max-w-md mx-auto text-muted-foreground">
				{t(WelcomeKeys.SUBHEADING)}
			</p>
		</div>
	);
}

function Features() {
	const { t } = useTranslation();
	return (
		// 2x2 on phones so the sign-in call to action stays above the fold — a
		// single column pushed it off-screen on an iPhone (TAVLI-4).
		<div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-12 w-full">
			<FeatureCard
				icon={<UtensilsCrossed size={24} />}
				iconColor="var(--accent-success)"
				title={t(WelcomeKeys.FEATURE_MENU_TITLE)}
				description={t(WelcomeKeys.FEATURE_MENU_DESC)}
			/>
			<FeatureCard
				icon={<QrCode size={24} />}
				iconColor="var(--accent-warning)"
				title={t(WelcomeKeys.FEATURE_TABLE_TITLE)}
				description={t(WelcomeKeys.FEATURE_TABLE_DESC)}
			/>
			<FeatureCard
				icon={<CalendarCheck size={24} />}
				iconColor="var(--accent-info)"
				title={t(WelcomeKeys.FEATURE_RESERVATIONS_TITLE)}
				description={t(WelcomeKeys.FEATURE_RESERVATIONS_DESC)}
			/>
			<FeatureCard
				icon={<Shield size={24} />}
				iconColor="var(--accent-secondary)"
				title={t(WelcomeKeys.FEATURE_AUTH_TITLE)}
				description={t(WelcomeKeys.FEATURE_AUTH_DESC)}
			/>
		</div>
	);
}

// Real anchors instead of <SignInButton mode="redirect">, for two reasons:
//
// 1. When clerk-js can't initialize, SignInButton renders a button whose tap
//    silently does nothing. That is how we found this: on device tests served
//    over http://bs-local.com (BrowserStack Local tunnel) the page is an
//    insecure context, crypto.subtle is unavailable, and clerk-js never loads
//    — on ANY browser, not just iOS. With the ClerkLoading/ClerkLoaded split
//    below, that state is now a visibly disabled button instead of a dead one.
// 2. Once clerk-js is ready the CTA is a plain href — a native navigation the
//    browser owns, with no JS between tap and redirect.
//
// The split also matters technically: `useClerk()` alone does NOT re-render
// when clerk-js finishes loading (load status lives in a separate context), so
// the URLs must be built inside <ClerkLoaded>.
function CallToAction() {
	const { t } = useTranslation();
	return (
		<div className="flex items-center justify-center gap-4">
			<ClerkLoading>
				<CallToActionLink href={undefined} className="hover-btn-secondary border border-border">
					<LogIn size={20} />
					{t(SidebarKeys.SIGN_IN)}
				</CallToActionLink>
				<CallToActionLink href={undefined} className="font-medium hover-btn-primary">
					<UserPlus size={20} />
					{t(WelcomeKeys.GET_STARTED)}
				</CallToActionLink>
			</ClerkLoading>
			<ClerkLoaded>
				<CallToActionLinks />
			</ClerkLoaded>
		</div>
	);
}

function CallToActionLinks() {
	const { t } = useTranslation();
	// Only rendered inside <ClerkLoaded>, so these return real URLs (they are
	// undefined before clerk-js loads) and window is available (never SSRed).
	// Without an explicit fallback redirect the hosted page dead-ends on
	// "Clerk cannot redirect to your application" after authenticating.
	const clerk = useClerk();
	const redirect = {
		signInFallbackRedirectUrl: window.location.href,
		signUpFallbackRedirectUrl: window.location.href,
	};
	return (
		<>
			<CallToActionLink
				href={clerk.buildSignInUrl(redirect)}
				className="hover-btn-secondary border border-border"
			>
				<LogIn size={20} />
				{t(SidebarKeys.SIGN_IN)}
			</CallToActionLink>
			<CallToActionLink
				href={clerk.buildSignUpUrl(redirect)}
				className="font-medium hover-btn-primary"
			>
				<UserPlus size={20} />
				{t(WelcomeKeys.GET_STARTED)}
			</CallToActionLink>
		</>
	);
}

function CallToActionLink({
	href,
	className,
	children,
}: Readonly<{ href: string | undefined; className: string; children: ReactNode }>) {
	const base = `flex items-center gap-2 px-6 py-3 rounded-xl ${className}`;
	if (!href) {
		return (
			<button className={`${base} opacity-60`} disabled>
				{children}
			</button>
		);
	}
	return (
		<a href={href} className={base}>
			{children}
		</a>
	);
}
