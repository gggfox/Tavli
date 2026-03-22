import { AVATAR_SIZE_CLASSES, AvatarProps } from "./types"

type UserIdentityInitialsProps = Readonly<AvatarProps>

export function UserIdentityInitials({ alt, size, className, style, fallback }: UserIdentityInitialsProps): React.ReactNode | null {
    const sizeClass = AVATAR_SIZE_CLASSES[size ?? "md"]
    return (
        <div
          className={`rounded-full flex items-center justify-center font-semibold ${sizeClass} ${className}`}
          style={{
            backgroundColor: "var(--btn-primary-bg)",
            color: "var(--btn-primary-text)",
            ...style,
          }}
          aria-label={alt}
        >
          {fallback}
        </div>
      )
}