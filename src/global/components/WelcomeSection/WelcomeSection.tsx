import { FeatureCard } from "@/global/components/FeatureCard/FeatureCard.tsx";
import { SidebarKeys, WelcomeKeys } from "@/global/i18n";
import { SignInButton, SignUpButton } from "@clerk/tanstack-react-start";
import { LogIn, QrCode, Shield, UserPlus, UtensilsCrossed } from "lucide-react";
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
		<div className="h-full flex flex-col items-center justify-center px-6 py-12 max-w-3xl mx-auto">
			{children}
		</div>
	);
}

function Hero() {
	const { t } = useTranslation();
	return (
		<div className="text-center mb-12">
			<div
				className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm mb-6 bg-success-subtle text-success border border-success"
				
			>
				<UtensilsCrossed size={14} />
				<span>{t(WelcomeKeys.BADGE)}</span>
			</div>
			<h1
				className="text-4xl md:text-5xl font-bold mb-4 tracking-tight text-foreground"
				
			>
				{t(WelcomeKeys.HEADING_PREFIX)}{" "}
				<span className="text-primary" >{t(SidebarKeys.BRAND_NAME)}</span>
			</h1>
			<p className="text-lg max-w-md mx-auto text-muted-foreground" >
				{t(WelcomeKeys.SUBHEADING)}
			</p>
		</div>
	);
}

function Features() {
	const { t } = useTranslation();
	return (
		<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12 w-full">
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
				icon={<Shield size={24} />}
				iconColor="var(--accent-secondary)"
				title={t(WelcomeKeys.FEATURE_AUTH_TITLE)}
				description={t(WelcomeKeys.FEATURE_AUTH_DESC)}
			/>
		</div>
	);
}

function CallToAction() {
	const { t } = useTranslation();
	return (
		<div className="flex items-center justify-center gap-4">
			<SignInButton mode="redirect">
				<button
					className="flex items-center gap-2 px-6 py-3 rounded-xl hover-btn-secondary border border-border"
					
				>
					<LogIn size={20} />
					{t(SidebarKeys.SIGN_IN)}
				</button>
			</SignInButton>
			<SignUpButton mode="redirect">
				<button className="flex items-center gap-2 px-6 py-3 rounded-xl font-medium hover-btn-primary">
					<UserPlus size={20} />
					{t(WelcomeKeys.GET_STARTED)}
				</button>
			</SignUpButton>
		</div>
	);
}
