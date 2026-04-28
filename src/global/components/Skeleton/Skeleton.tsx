import type { CSSProperties } from "react";

interface SkeletonProps {
	readonly className?: string;
	readonly style?: CSSProperties;
	readonly rounded?: "sm" | "md" | "lg" | "xl" | "full";
	readonly as?: "div" | "span";
	readonly ariaHidden?: boolean;
}

const ROUNDED_CLASS = {
	sm: "rounded",
	md: "rounded-md",
	lg: "rounded-lg",
	xl: "rounded-xl",
	full: "rounded-full",
} as const;

export function Skeleton({
	className = "",
	style,
	rounded = "md",
	as = "div",
	ariaHidden = true,
}: SkeletonProps) {
	const Tag = as;
	return (
		<Tag
			aria-hidden={ariaHidden}
			className={`block animate-pulse ${ROUNDED_CLASS[rounded]} ${className}`}
			style={{
				backgroundColor: "var(--bg-hover)",
				...style,
			}}
		/>
	);
}
