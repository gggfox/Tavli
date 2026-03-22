import type { ReactElement } from "react"
import { AVATAR_SIZE_CLASSES, AvatarProps } from "./types"

type UserProfileImageProps = Readonly<Omit<AvatarProps, "src"> & { src: string }> 
export function UserProfileImage({ src, alt, size, className, style }: UserProfileImageProps): ReactElement | null {
    const sizeClass = AVATAR_SIZE_CLASSES[size ?? "md"]
    return (
        <img
        src={src}
        alt={alt}
        className={`rounded-full object-cover ${sizeClass} ${className}`}
        style={{
        boxShadow: "0 0 0 2px var(--border-default)",
        ...style,
        }}
    />
    )
}