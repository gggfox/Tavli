import { describe, expect, it } from "vitest";
import {
	currencySymbol,
	DEFAULT_DISPLAY_CURRENCY,
	formatMoney,
	moneyLocale,
	parseDollarsToCents,
} from "./money";

describe("moneyLocale", () => {
	it("maps the two app languages onto the product's market locales", () => {
		expect(moneyLocale("es")).toBe("es-MX");
		expect(moneyLocale("es-MX")).toBe("es-MX");
		expect(moneyLocale("en")).toBe("en-US");
	});

	it("falls back to en-US for anything unrecognised", () => {
		expect(moneyLocale(undefined)).toBe("en-US");
		expect(moneyLocale("fr")).toBe("en-US");
	});
});

describe("formatMoney", () => {
	it("formats MXN in Spanish with the market's own separators, not es-ES", () => {
		expect(formatMoney(200000, "MXN", "es")).toBe("$2,000.00");
	});

	it("formats MXN in English as `$`, not `MX$`", () => {
		expect(formatMoney(200000, "MXN", "en")).toBe("$2,000.00");
	});

	it("formats USD in English", () => {
		expect(formatMoney(12345, "USD", "en")).toBe("$123.45");
	});

	it("formats EUR with the euro sign in both languages", () => {
		expect(formatMoney(1050, "EUR", "en")).toBe("€10.50");
		expect(formatMoney(1050, "EUR", "es")).toBe("€10.50");
	});

	it("treats JPY amounts as whole yen (zero-decimal minor unit)", () => {
		expect(formatMoney(1500, "JPY", "en")).toBe("¥1,500");
	});

	it("accepts Stripe's lower-case currency codes", () => {
		expect(formatMoney(100000, "mxn", "es")).toBe("$1,000.00");
	});

	it("renders negative amounts (refunds) with a leading minus", () => {
		expect(formatMoney(-500, "MXN", "es")).toBe("-$5.00");
		expect(formatMoney(-500, "EUR", "en")).toBe("-€5.00");
	});

	it("uses the default currency when none is given", () => {
		expect(DEFAULT_DISPLAY_CURRENCY).toBe("MXN");
		expect(formatMoney(999, undefined, "en")).toBe("$9.99");
		expect(formatMoney(999, "", "en")).toBe("$9.99");
		expect(formatMoney(999, null, "en")).toBe("$9.99");
	});

	it("falls back to a readable number plus the code for an invalid currency, never throwing", () => {
		expect(() => formatMoney(200000, "US", "en")).not.toThrow();
		expect(formatMoney(200000, "US", "en")).toBe("2,000.00 US");
		expect(formatMoney(-150, "not-a-code", "es")).toBe("-1.50 NOT-A-CODE");
	});

	it("round-trips through parseDollarsToCents via the grouped display string", () => {
		const shown = formatMoney(200000, "MXN", "en").replace("$", "");
		expect(parseDollarsToCents(shown)).toBe(200000);
	});
});

describe("currencySymbol", () => {
	it("returns the narrow symbol for a price input adornment", () => {
		expect(currencySymbol("MXN", "es")).toBe("$");
		expect(currencySymbol("EUR", "en")).toBe("€");
		expect(currencySymbol("GBP", "es")).toBe("£");
	});

	it("falls back to the code for an invalid currency", () => {
		expect(currencySymbol("US", "en")).toBe("US");
	});
});
