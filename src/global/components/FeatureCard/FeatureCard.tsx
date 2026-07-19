import type { ReactNode } from "react";

export type FeatureCardProps = Readonly<
	Omit<FeatureCardContainerProps, "children"> &
		FeatureCardIconProps &
		FeatureCardTitleProps &
		FeatureCardDescriptionProps
>;

type FeatureCardContainerProps = Readonly<{
	children: ReactNode;
	className?: string;
}>;

type FeatureCardIconProps = Readonly<{
	icon: ReactNode;
	iconColor?: string;
}>;

type FeatureCardTitleProps = Readonly<{
	title: string;
}>;

type FeatureCardDescriptionProps = Readonly<{
	description: string;
}>;

/**
 * Reusable feature card component for displaying feature highlights.
 * Consolidates duplicated feature card patterns from WelcomeSection.
 */
export function FeatureCard({
	icon,
	title,
	description,
	iconColor,
	className = "",
}: FeatureCardProps) {
	return (
		<FeatureCardContainer className={className}>
			<FeatureCardIcon icon={icon} iconColor={iconColor} />
			<FeatureCardTitle title={title} />
			<FeatureCardDescription description={description} />
		</FeatureCardContainer>
	);
}

function FeatureCardContainer({ children, className }: FeatureCardContainerProps) {
	return (
		// Denser below sm: four of these stack 2x2 on phones and have to leave room
		// for the sign-in call to action without scrolling (TAVLI-4).
		<div className={`${`p-3 sm:p-4 rounded-xl ${className}`} bg-muted border border-border`}>
			{children}
		</div>
	);
}

function FeatureCardIcon({ icon, iconColor }: FeatureCardIconProps) {
	return (
		<div className="mb-2 sm:mb-3" style={iconColor ? { color: iconColor } : undefined}>
			{icon}
		</div>
	);
}

function FeatureCardTitle({ title }: FeatureCardTitleProps) {
	return <h3 className="text-sm sm:text-base font-medium mb-1 text-foreground">{title}</h3>;
}

function FeatureCardDescription({ description }: FeatureCardDescriptionProps) {
	return <p className="text-xs sm:text-sm text-soft-foreground">{description}</p>;
}
