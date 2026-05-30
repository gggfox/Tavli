export type InviteEmailLocale = "en" | "es";

/** Normalize restaurant/org defaultLanguage to supported invite email locale. */
export function resolveInviteLocale(defaultLanguage?: string | null): InviteEmailLocale {
	if (defaultLanguage?.toLowerCase().startsWith("es")) return "es";
	return "en";
}

export function formatExpiresAt(expiresAt: number, locale: InviteEmailLocale): string {
	return new Intl.DateTimeFormat(locale === "es" ? "es-MX" : "en-US", {
		dateStyle: "long",
		timeStyle: "short",
	}).format(new Date(expiresAt));
}
