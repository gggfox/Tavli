/**
 * Contact-phone canonicalization.
 *
 * A phone number is the only identity a reservation customer has (ADR-011), and
 * `findUpcomingByPhone` matches `contact.phone` through an exact index lookup.
 * Staff typed `8114906208`, the web form took whatever was pasted, and WhatsApp
 * delivered `+5218114906208` — three spellings of one human, none of which
 * matched each other, so the assistant could never find a booking made anywhere
 * but WhatsApp.
 *
 * The rule these tests pin down: normalize confidently or not at all. A number
 * we cannot place is stored exactly as it was typed, because a mangled phone is
 * worse than an unmatched one — staff still have to ring it.
 */
import { describe, expect, it } from "vitest";
import { normalizeContactPhone } from "../_util/phone";

const MX = "America/Mexico_City";
const US = "America/New_York";

describe("normalizeContactPhone", () => {
	describe("national numbers, using the restaurant's timezone for the country", () => {
		it("prefixes a bare Mexican 10-digit number", () => {
			expect(normalizeContactPhone("8114906208", MX)).toBe("+528114906208");
		});

		it("ignores the spacing and punctuation people type", () => {
			expect(normalizeContactPhone("811 490 6208", MX)).toBe("+528114906208");
			expect(normalizeContactPhone("(811) 490-6208", MX)).toBe("+528114906208");
			expect(normalizeContactPhone(" 811.490.6208 ", MX)).toBe("+528114906208");
		});

		it("uses the restaurant's own country, not a hardcoded one", () => {
			expect(normalizeContactPhone("4155238886", US)).toBe("+14155238886");
		});

		it("leaves a national number alone when the timezone is not a country we know", () => {
			// Guessing +52 for a restaurant in Madrid would produce a number that
			// dials someone else entirely.
			expect(normalizeContactPhone("600123456", "Europe/Madrid")).toBe("600123456");
		});

		it("falls back to Mexico when the restaurant has no timezone set", () => {
			// Same default as DEFAULT_RESTAURANT_TIMEZONE.
			expect(normalizeContactPhone("8114906208", undefined)).toBe("+528114906208");
		});
	});

	describe("numbers that already carry a country code", () => {
		it("keeps an international number from another country", () => {
			expect(normalizeContactPhone("+14155238886", MX)).toBe("+14155238886");
		});

		it("accepts 00 as the international prefix", () => {
			expect(normalizeContactPhone("0052 811 490 6208", MX)).toBe("+528114906208");
		});

		it("is idempotent on an already-canonical number", () => {
			expect(normalizeContactPhone("+528114906208", MX)).toBe("+528114906208");
		});
	});

	describe("the Mexican mobile 1", () => {
		it("drops the legacy 1 WhatsApp puts after the country code", () => {
			expect(normalizeContactPhone("+5218114906208", MX)).toBe("+528114906208");
		});

		it("drops it regardless of the restaurant's country", () => {
			expect(normalizeContactPhone("+5218114906208", US)).toBe("+528114906208");
		});

		it("keeps the 9 in Argentine mobiles, which is required to dial them", () => {
			expect(normalizeContactPhone("+5491123456789", MX)).toBe("+5491123456789");
		});
	});

	describe("anything it cannot place is left exactly as typed", () => {
		it("keeps a national number of unexpected length", () => {
			expect(normalizeContactPhone("12345", MX)).toBe("12345");
			expect(normalizeContactPhone("81149062080000", MX)).toBe("81149062080000");
		});

		it("keeps free text", () => {
			expect(normalizeContactPhone("no tiene teléfono", MX)).toBe("no tiene teléfono");
			expect(normalizeContactPhone("ext. 4102", MX)).toBe("ext. 4102");
		});

		it("keeps an implausibly short or long international number", () => {
			expect(normalizeContactPhone("+123", MX)).toBe("+123");
			expect(normalizeContactPhone("+1234567890123456789", MX)).toBe("+1234567890123456789");
		});

		it("passes an empty value straight through", () => {
			expect(normalizeContactPhone("", MX)).toBe("");
			expect(normalizeContactPhone("   ", MX)).toBe("");
		});
	});
});
