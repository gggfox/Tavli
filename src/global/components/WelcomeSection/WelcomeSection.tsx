import { FeatureCard } from "@/global/components/FeatureCard/FeatureCard.tsx";
import { SignInButton, SignUpButton } from "@clerk/tanstack-react-start";
import { LogIn, QrCode, Shield, UserPlus, UtensilsCrossed } from "lucide-react";

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
				<UtensilsCrossed size={14} />
				<span>Restaurant Menu Management</span>
			</div>
			<h1
				className="text-4xl md:text-5xl font-bold mb-4 tracking-tight"
				style={{ color: "var(--text-primary)" }}
			>
				Welcome to <span style={{ color: "var(--btn-primary-bg)" }}>Tavli</span>
			</h1>
			<p className="text-lg max-w-md mx-auto" style={{ color: "var(--text-secondary)" }}>
				Manage your restaurants, menus, and orders. Customers scan a QR code to browse and order
				from their table.
			</p>
		</div>
	);
}

function Features() {
	return (
		<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12 w-full">
			<FeatureCard
				icon={<UtensilsCrossed size={24} />}
				iconColor="var(--accent-success)"
				title="Menu Builder"
				description="Create and manage menus with categories, items, and option groups."
			/>
			<FeatureCard
				icon={<QrCode size={24} />}
				iconColor="var(--accent-warning)"
				title="Table Ordering"
				description="Customers order from their table via a unique link or QR code."
			/>
			<FeatureCard
				icon={<Shield size={24} />}
				iconColor="var(--accent-secondary)"
				title="Secure Auth"
				description="Manage staff roles with secure authentication via Clerk."
			/>
		</div>
	);
}

function CallToAction() {
	return (
		<div className="flex items-center justify-center gap-4">
			<SignInButton mode="redirect">
				<button
					className="flex items-center gap-2 px-6 py-3 rounded-xl hover-btn-secondary"
					style={{ border: "1px solid var(--border-default)" }}
				>
					<LogIn size={20} />
					Sign In
				</button>
			</SignInButton>
			<SignUpButton mode="redirect">
				<button className="flex items-center gap-2 px-6 py-3 rounded-xl font-medium hover-btn-primary">
					<UserPlus size={20} />
					Get Started
				</button>
			</SignUpButton>
		</div>
	);
}
