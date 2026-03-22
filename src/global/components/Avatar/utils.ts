/**
 * Helper to generate avatar fallback text from user data
 */
export function getAvatarFallback(
  firstName?: string | null,
  email?: string | null
): string {
  if (firstName?.[0]) return firstName[0].toUpperCase();
  if (email?.[0]) return email[0].toUpperCase();
  return "?";
}
