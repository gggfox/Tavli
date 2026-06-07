import { RestaurantsKeys } from "@/global/i18n";
import type { TFunction } from "i18next";

const TABLE_ERROR_TO_KEY: Record<string, string> = {
	ERROR_TABLE_NUMBER_EXISTS: RestaurantsKeys.TABLES_ERROR_NUMBER_EXISTS,
};

export function mapTableError(message: string, t: TFunction, fallbackKey: string): string {
	const code = message.includes(": ")
		? message.split(": ").slice(1).join(": ").trim()
		: message.trim();
	const key = TABLE_ERROR_TO_KEY[code];
	return key ? t(key) : t(fallbackKey);
}
