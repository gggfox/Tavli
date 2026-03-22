import { UserProfileImage } from "./UserProfileImage"
import { UserIdentityInitials } from "./UserIdentityInitials"
import { AvatarProps } from "./types"

/**
 * Reusable Avatar component that handles image or fallback initials.
 * Consolidates duplicated avatar rendering logic from SidebarUserSection.
 */
export function Avatar(props: Readonly<AvatarProps>) {
  const src = props.src;
  if (src) {
    return <UserProfileImage {...props} src={src}/>
  }
  return <UserIdentityInitials {...props}/>
}
