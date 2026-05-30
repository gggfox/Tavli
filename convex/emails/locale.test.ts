import { describe, expect, it } from "vitest";
import { formatExpiresAt, resolveInviteLocale } from "./locale";

describe("resolveInviteLocale", () => {
	it("returns es for Spanish language codes", () => {
		expect(resolveInviteLocale("es")).toBe("es");
		expect(resolveInviteLocale("es-MX")).toBe("es");
	});

	it("returns en for English and unknown codes", () => {
		expect(resolveInviteLocale("en")).toBe("en");
		expect(resolveInviteLocale("en-US")).toBe("en");
		expect(resolveInviteLocale(undefined)).toBe("en");
		expect(resolveInviteLocale(null)).toBe("en");
	});
});

describe("formatExpiresAt", () => {
	it("formats dates for en and es locales", () => {
		const expiresAt = new Date("2026-06-06T15:00:00Z").getTime();
		expect(formatExpiresAt(expiresAt, "en")).toMatch(/June 6, 2026/);
		expect(formatExpiresAt(expiresAt, "es")).toMatch(/2026/);
	});
});
