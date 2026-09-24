/* eslint-disable boundaries/no-unknown-files */
import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import es from "./locales/es.json";
import { ERROR_CODE_KEYS } from "./keys/errors";
import { MenusKeys } from "./keys/menus";
import { OrderingKeys } from "./keys/ordering";

function resolve(locale: unknown, key: string): unknown {
	return key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], locale);
}

describe("AI image i18n", () => {
	it.each([
		MenusKeys.AI_IMAGE_GENERATE,
		MenusKeys.AI_IMAGE_GENERATING,
		MenusKeys.AI_IMAGE_ATTEMPT,
		MenusKeys.AI_IMAGE_USE,
		MenusKeys.AI_IMAGE_REGENERATE,
		MenusKeys.AI_IMAGE_DISCARD,
		MenusKeys.AI_IMAGE_BADGE,
		MenusKeys.AI_IMAGE_BADGE_TOOLTIP,
		MenusKeys.AI_IMAGE_REMAINING,
		MenusKeys.AI_IMAGE_LIMIT_OFF,
		MenusKeys.AI_IMAGE_FAILED,
		OrderingKeys.MENU_GENERATED_IMAGE,
		OrderingKeys.MENU_GENERATED_IMAGE_DETAIL,
		ERROR_CODE_KEYS.AI_IMAGE_GENERATION_IN_PROGRESS,
		ERROR_CODE_KEYS.AI_IMAGE_MONTHLY_LIMIT_REACHED,
		ERROR_CODE_KEYS.AI_IMAGE_CREDITS_EXHAUSTED,
		ERROR_CODE_KEYS.AI_IMAGE_CONTENT_BLOCKED,
		ERROR_CODE_KEYS.AI_IMAGE_GENERATION_FAILED,
	])("%s resolves in both locales", (key) => {
		expect(typeof resolve(en, key)).toBe("string");
		expect(typeof resolve(es, key)).toBe("string");
	});
});
