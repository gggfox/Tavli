import { FeatureCard } from "@/global/components/FeatureCard/FeatureCard.tsx";
import { CheckCircle2, LogIn, Shield, UserPlus, Zap } from "lucide-react";

/**
 * Welcome section shown when user is not authenticated
 */
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
	return (
		<div className="text-center mb-12">
			<div
				className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm mb-6"
				style={{
					backgroundColor: "var(--accent-success-light)",
					color: "var(--accent-success)",
					border: "1px solid var(--accent-success)",
				}}
			>
				<Zap size={14} />
				<span>Simple Task Management</span>
			</div>
			<h1
				className="text-4xl md:text-5xl font-bold mb-4 tracking-tight"
				style={{ color: "var(--text-primary)" }}
			>
				Welcome to <span style={{ color: "var(--btn-primary-bg)" }}>Fierro Viejo</span>
			</h1>
			<p className="text-lg max-w-md mx-auto" style={{ color: "var(--text-secondary)" }}>
				A minimal, focused task manager. Sign in to start organizing your work.
			</p>
		</div>
	);
}

function Features() {
	return (
		<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12 w-full">
			<FeatureCard
				icon={<CheckCircle2 size={24} />}
				iconColor="var(--accent-success)"
				title="Simple Tasks"
				description="Create, complete, and organize tasks with ease."
			/>
			<FeatureCard
				icon={<Zap size={24} />}
				iconColor="var(--accent-warning)"
				title="Real-time Sync"
				description="Powered by Convex for instant updates across devices."
			/>
			<FeatureCard
				icon={<Shield size={24} />}
				iconColor="var(--accent-secondary)"
				title="Secure Auth"
				description="Enterprise-grade authentication with WorkOS."
			/>
		</div>
	);
}

function CallToAction() {
	return (
		<div className="flex items-center justify-center gap-4">
			<a
				href="/api/auth/signin"
				className="flex items-center gap-2 px-6 py-3 rounded-xl hover-btn-secondary"
				style={{ border: "1px solid var(--border-default)" }}
			>
				<LogIn size={20} />
				Sign In
			</a>
			<a
				href="/api/auth/signup"
				className="flex items-center gap-2 px-6 py-3 rounded-xl font-medium hover-btn-primary"
			>
				<UserPlus size={20} />
				Get Started
			</a>
		</div>
	);
}
