/**
 * Surface — themed container primitive.
 *
 * Replaces the long-running pattern of writing
 *   <div style={{ backgroundColor: "var(--bg-secondary)",
 *                 border: "1px solid var(--border-default)" }}>
 * by hand. Maps semantic tones to CSS-variable colors so theming stays
 * centralized.
 *
 * Polymorphic via `as`: pass `as="button"` for clickable cards, the prop
 * forwards through to the underlying element.
 */
import { forwardRef, type CSSProperties, type ElementType, type ReactNode } from "react";

export type SurfaceTone = "primary" | "secondary" | "tertiary" | "elevated" | "transparent";
export type SurfaceRounded = "none" | "md" | "lg" | "xl" | "full";

interface SurfaceOwnProps {
	readonly tone?: SurfaceTone;
	readonly bordered?: boolean;
	readonly rounded?: SurfaceRounded;
	readonly interactive?: boolean;
	readonly className?: string;
	readonly style?: CSSProperties;
	readonly children?: ReactNode;
}

const TONE_TO_VAR: Record<SurfaceTone, string | undefined> = {
	primary: "var(--bg-primary)",
	secondary: "var(--bg-secondary)",
	tertiary: "var(--bg-tertiary)",
	elevated: "var(--bg-elevated)",
	transparent: undefined,
};

const ROUNDED_CLASSES: Record<SurfaceRounded, string> = {
	none: "",
	md: "rounded-md",
	lg: "rounded-lg",
	xl: "rounded-xl",
	full: "rounded-full",
};

type SurfaceProps<E extends ElementType> = SurfaceOwnProps & {
	readonly as?: E;
} & Omit<React.ComponentPropsWithoutRef<E>, keyof SurfaceOwnProps | "as">;

function SurfaceImpl<E extends ElementType = "div">(
	{
		as,
		tone = "secondary",
		bordered = true,
		rounded = "lg",
		interactive = false,
		className = "",
		style,
		children,
		...rest
	}: SurfaceProps<E>,
	ref: React.Ref<Element>
) {
	const Component = (as ?? "div") as ElementType;

	const backgroundColor = TONE_TO_VAR[tone];
	const mergedStyle: CSSProperties = {
		...(backgroundColor !== undefined ? { backgroundColor } : {}),
		...(bordered ? { border: "1px solid var(--border-default)" } : {}),
		...style,
	};

	const classes = [
		ROUNDED_CLASSES[rounded],
		interactive ? "transition-colors hover:bg-(--bg-hover) cursor-pointer" : "",
		className,
	]
		.filter(Boolean)
		.join(" ");

	return (
		<Component ref={ref} className={classes} style={mergedStyle} {...rest}>
			{children}
		</Component>
	);
}

/**
 * Themed container primitive. See module docs for details.
 *
 * @example
 * <Surface>...</Surface>
 * <Surface tone="primary" rounded="xl">...</Surface>
 * <Surface as="button" interactive onClick={onPick}>...</Surface>
 */
export const Surface = forwardRef(SurfaceImpl) as <E extends ElementType = "div">(
	props: SurfaceProps<E> & { ref?: React.Ref<Element> }
) => React.ReactElement | null;
