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
