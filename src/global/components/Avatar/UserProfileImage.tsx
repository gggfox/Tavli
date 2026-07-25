import type { ReactElement } from "react";
import { AVATAR_SIZE_CLASSES, AVATAR_SIZE_PIXELS, AvatarProps } from "./types";

type UserProfileImageProps = Readonly<Omit<AvatarProps, "src"> & { src: string }>;
export function UserProfileImage({
	src,
	alt,
	size,
	className,
	style,
}: UserProfileImageProps): ReactElement | null {
	const resolvedSize = size ?? "md";
	const sizeClass = AVATAR_SIZE_CLASSES[resolvedSize];
	const pixels = AVATAR_SIZE_PIXELS[resolvedSize];
	return (
		<img
			src={src}
			alt={alt}
			// Avatars are small, remote, and frequently below the fold (member
			// lists, order history). Intrinsic width/height come from the same
			// map as the size classes, so the box is reserved before load and
			// the aspect ratio is never distorted.
			width={pixels}
			height={pixels}
			loading="lazy"
			decoding="async"
			className={`rounded-full object-cover ${sizeClass} ${className}`}
			style={{
				boxShadow: "0 0 0 2px var(--border-default)",
				...style,
			}}
		/>
	);
}
