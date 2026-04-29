import { getTranslatedField } from "@/global/utils/translations";
import { useTranslation } from "react-i18next";

/**
 * Looks up a localized name for a record whose source row may be gone but
 * whose translations were captured (or are still queryable) alongside a
 * snapshot of the original name.
 *
 * Used by views over `orderItems` (kitchen, payments, audit) where the
 * snapshot in `menuItemName` / `optionName` is the floor we never go below,
 * but if the live menu/option still exists we want to honor the user's
 * current UI language.
 *
 * Pure logic lives in `localizeName` so non-React callers (Convex queries,
 * server-rendered receipts, etc.) can reuse it.
 */
export function useLocalizedName(
	snapshot: string,
	translations?: Record<string, { name?: string }>
): string {
	const { i18n } = useTranslation();
	return localizeName(snapshot, translations, i18n.language);
}

/**
 * Resolves a translated `name`, defaulting to `snapshot` when no translation
 * is available for the requested language. Always returns a non-empty string
 * unless the caller passes an empty `snapshot`.
 */
export function localizeName(
	snapshot: string,
	translations: Record<string, { name?: string }> | undefined,
	lang: string | undefined
): string {
	const normalized = lang ? lang.split("-")[0] : undefined;
	return getTranslatedField({ name: snapshot, translations }, normalized, "name");
}
