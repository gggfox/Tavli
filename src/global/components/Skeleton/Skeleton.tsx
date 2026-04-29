import type { CSSProperties, ReactNode } from "react";
import { Surface, type SurfaceRounded, type SurfaceTone } from "../Surface";

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

function SkeletonBase({
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

interface SkeletonCardProps {
	readonly children?: ReactNode;
	readonly className?: string;
	readonly rounded?: SurfaceRounded;
	readonly tone?: SurfaceTone;
	readonly bordered?: boolean;
	readonly style?: CSSProperties;
}

/**
 * Skeleton.Card — `<Surface>` with skeleton-friendly defaults. Replaces
 * the hand-rolled `<div className="rounded-xl border border-border" style={{backgroundColor:
 * "var(--bg-secondary)"}}>`
 * pattern found inside every per-feature skeleton.
 */
function SkeletonCard({
	children,
	className = "",
	rounded = "lg",
	tone = "secondary",
	bordered = true,
	style,
}: SkeletonCardProps) {
	return (
		<Surface
			tone={tone}
			rounded={rounded}
			bordered={bordered}
			className={className}
			style={style}
		>
			{children}
		</Surface>
	);
}

interface SkeletonRepeatProps {
	readonly count: number;
	readonly keyPrefix: string;
	readonly children: (index: number) => ReactNode;
	readonly className?: string;
}

/**
 * Skeleton.Repeat — `Array.from({ length: count }, …)` shorthand for the
 * common case of rendering N identical skeleton rows/cards. Does not
 * impose a layout; wrap the call in whatever container you need.
 */
function SkeletonRepeat({ count, keyPrefix, children, className }: SkeletonRepeatProps) {
	const items = [];
	for (let i = 0; i < count; i++) {
		items.push(
			<div key={`${keyPrefix}-${i}`} className={className}>
				{children(i)}
			</div>
		);
	}
	return <>{items}</>;
}

type SkeletonComponent = typeof SkeletonBase & {
	Card: typeof SkeletonCard;
	Repeat: typeof SkeletonRepeat;
};

export const Skeleton = SkeletonBase as SkeletonComponent;
Skeleton.Card = SkeletonCard;
Skeleton.Repeat = SkeletonRepeat;
