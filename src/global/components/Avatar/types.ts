import { CSSProperties } from "react";

export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps {
	/** Image URL for the avatar */
	src?: string | null;
	/** Alt text for the image */
	alt?: string;
	/** Fallback text to show when no image (usually initials) */
	fallback: string;
	/** Size of the avatar */
	size?: AvatarSize;
	/** Additional CSS classes */
	className?: string;
	/** Additional inline styles */
	style?: CSSProperties;
}

const AVATAR_SIZE_CLASSES_ENUM = {
	sm: "sm",
	md: "md",
	lg: "lg",
} as const;

export const AVATAR_SIZE_CLASSES: Record<AvatarSize, string> = {
	[AVATAR_SIZE_CLASSES_ENUM.sm]: "w-6 h-6 text-xs",
	[AVATAR_SIZE_CLASSES_ENUM.md]: "w-8 h-8 text-sm",
	[AVATAR_SIZE_CLASSES_ENUM.lg]: "w-10 h-10 text-base",
};

/**
 * Rendered pixel size of each avatar, in lockstep with the `w-*`/`h-*`
 * classes above (Tailwind spacing: 6 -> 24px, 8 -> 32px, 10 -> 40px). Used as
 * the `<img>` intrinsic size so avatars reserve their box before the image
 * loads instead of reflowing the row around them.
 */
export const AVATAR_SIZE_PIXELS: Record<AvatarSize, number> = {
	[AVATAR_SIZE_CLASSES_ENUM.sm]: 24,
	[AVATAR_SIZE_CLASSES_ENUM.md]: 32,
	[AVATAR_SIZE_CLASSES_ENUM.lg]: 40,
};
