import { RestaurantsKeys } from "@/global/i18n";
import { extractErrorCode } from "@/global/utils/errorMessages";
import type { TFunction } from "i18next";

const TABLE_ERROR_TO_KEY: Record<string, string> = {
	ERROR_TABLE_NUMBER_EXISTS: RestaurantsKeys.TABLES_ERROR_NUMBER_EXISTS,
};

/**
 * Maps a caught table-mutation error to a localized message. Table-specific
 * codes resolve to their dedicated key; anything else falls back to
 * `fallbackKey`. Accepts the raw caught value (string message or Error) so the
 * stable code is extracted even from the wrapped `[CONVEX …] CODE` format.
 */
export function mapTableError(error: unknown, t: TFunction, fallbackKey: string): string {
	const code = extractErrorCode(error);
	const key = code && TABLE_ERROR_TO_KEY[code] ? TABLE_ERROR_TO_KEY[code] : fallbackKey;
	return t(key);
}
