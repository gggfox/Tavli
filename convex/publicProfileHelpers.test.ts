import { describe, expect, it } from "vitest";
import {
	MAX_ADDRESS_LENGTH,
	normalizeRestaurantPhone,
	normalizeSocialInput,
	normalizeSocialUrl,
	PUBLIC_PROFILE_ERROR,
	SOCIAL_FIELD,
	SOCIAL_PLATFORM,
	SOCIAL_PLATFORMS,
	isValidContactEmail,
	toTelHref,
	toWhatsAppUrl,
} from "./publicProfileHelpers";

function expectUrl(platform: Parameters<typeof normalizeSocialUrl>[0], input: string) {
	const result = normalizeSocialUrl(platform, input);
	if (!result.ok) throw new Error(`expected ${input} to normalize, got ${result.code}`);
	return result.value;
}

function expectCode(platform: Parameters<typeof normalizeSocialUrl>[0], input: string) {
	const result = normalizeSocialUrl(platform, input);
	if (result.ok) throw new Error(`expected ${input} to be rejected, got ${result.value}`);
	return result.code;
}

describe("normalizeSocialUrl — the shapes owners actually paste", () => {
	it("accepts a full URL, a bare host, and a www host as the same profile", () => {
		const canonical = "https://instagram.com/lacocina";
		expect(expectUrl(SOCIAL_PLATFORM.INSTAGRAM, "https://instagram.com/lacocina")).toBe(canonical);
		expect(expectUrl(SOCIAL_PLATFORM.INSTAGRAM, "instagram.com/lacocina")).toBe(canonical);
		expect(expectUrl(SOCIAL_PLATFORM.INSTAGRAM, "www.instagram.com/lacocina")).toBe(canonical);
		expect(expectUrl(SOCIAL_PLATFORM.INSTAGRAM, "https://m.instagram.com/lacocina")).toBe(
			canonical
		);
		expect(expectUrl(SOCIAL_PLATFORM.INSTAGRAM, "  instagram.com/lacocina/  ")).toBe(canonical);
	});

	it("upgrades http to https", () => {
		expect(expectUrl(SOCIAL_PLATFORM.INSTAGRAM, "http://instagram.com/lacocina")).toBe(
			"https://instagram.com/lacocina"
		);
	});

	it("drops tracking params, which leak a diner's referral chain", () => {
		expect(
			expectUrl(SOCIAL_PLATFORM.INSTAGRAM, "https://instagram.com/lacocina?igshid=abc123")
		).toBe("https://instagram.com/lacocina");
		expect(expectUrl(SOCIAL_PLATFORM.TIKTOK, "https://tiktok.com/@lacocina?_t=8xyz&_r=1")).toBe(
			"https://tiktok.com/@lacocina"
		);
		expect(expectUrl(SOCIAL_PLATFORM.YOUTUBE, "https://youtube.com/@lacocina?si=Q1")).toBe(
			"https://youtube.com/@lacocina"
		);
	});

	it("rewrites twitter.com to x.com so diners never see the dead brand", () => {
		expect(expectUrl(SOCIAL_PLATFORM.X, "https://twitter.com/lacocina")).toBe(
			"https://x.com/lacocina"
		);
		expect(expectUrl(SOCIAL_PLATFORM.X, "https://x.com/lacocina")).toBe("https://x.com/lacocina");
	});

	it("keeps the id on facebook profile.php, which identifies the page rather than the visitor", () => {
		expect(
			expectUrl(SOCIAL_PLATFORM.FACEBOOK, "https://facebook.com/profile.php?id=61550123456789")
		).toBe("https://facebook.com/profile.php?id=61550123456789");
	});

	it("rejects profile.php without a usable numeric id", () => {
		expect(expectCode(SOCIAL_PLATFORM.FACEBOOK, "https://facebook.com/profile.php")).toBe(
			PUBLIC_PROFILE_ERROR.SOCIAL_URL_INVALID
		);
		expect(expectCode(SOCIAL_PLATFORM.FACEBOOK, "https://facebook.com/profile.php?id=abc")).toBe(
			PUBLIC_PROFILE_ERROR.SOCIAL_URL_INVALID
		);
	});

	it("accepts the youtube path shapes that exist in the wild", () => {
		expect(expectUrl(SOCIAL_PLATFORM.YOUTUBE, "https://youtube.com/@lacocina")).toBe(
			"https://youtube.com/@lacocina"
		);
		expect(
			expectUrl(SOCIAL_PLATFORM.YOUTUBE, "https://youtube.com/channel/UCabcdefghijklmnopqrstuv")
		).toBe("https://youtube.com/channel/UCabcdefghijklmnopqrstuv");
		expect(expectUrl(SOCIAL_PLATFORM.YOUTUBE, "https://youtube.com/c/LaCocina")).toBe(
			"https://youtube.com/c/LaCocina"
		);
	});

	it("treats an empty value as a successful clear", () => {
		const result = normalizeSocialUrl(SOCIAL_PLATFORM.INSTAGRAM, "   ");
		expect(result).toEqual({ ok: true, value: "" });
	});
});

describe("normalizeSocialUrl — what it refuses to store", () => {
	it("rejects a link to the wrong platform", () => {
		expect(expectCode(SOCIAL_PLATFORM.INSTAGRAM, "https://facebook.com/lacocina")).toBe(
			PUBLIC_PROFILE_ERROR.SOCIAL_URL_WRONG_PLATFORM
		);
	});

	it("rejects shortlinks rather than guessing what they redirect to", () => {
		expect(expectCode(SOCIAL_PLATFORM.FACEBOOK, "https://fb.me/abc123")).toBe(
			PUBLIC_PROFILE_ERROR.SOCIAL_URL_SHORTLINK
		);
		expect(expectCode(SOCIAL_PLATFORM.YOUTUBE, "https://youtu.be/dQw4w9WgXcQ")).toBe(
			PUBLIC_PROFILE_ERROR.SOCIAL_URL_SHORTLINK
		);
		expect(expectCode(SOCIAL_PLATFORM.TIKTOK, "https://vm.tiktok.com/ZMabc/")).toBe(
			PUBLIC_PROFILE_ERROR.SOCIAL_URL_SHORTLINK
		);
	});

	it("rejects a bare platform homepage — the most likely paste mistake", () => {
		expect(expectCode(SOCIAL_PLATFORM.INSTAGRAM, "https://instagram.com")).toBe(
			PUBLIC_PROFILE_ERROR.SOCIAL_URL_INVALID
		);
		expect(expectCode(SOCIAL_PLATFORM.INSTAGRAM, "https://instagram.com/")).toBe(
			PUBLIC_PROFILE_ERROR.SOCIAL_URL_INVALID
		);
	});

	it("rejects non-http protocols instead of prefixing https onto them", () => {
		expect(expectCode(SOCIAL_PLATFORM.INSTAGRAM, "javascript:alert(1)")).toBe(
			PUBLIC_PROFILE_ERROR.SOCIAL_URL_INSECURE
		);
		expect(expectCode(SOCIAL_PLATFORM.INSTAGRAM, "data:text/html,<script>alert(1)</script>")).toBe(
			PUBLIC_PROFILE_ERROR.SOCIAL_URL_INSECURE
		);
	});

	it("rejects embedded credentials, which read as one host and resolve to another", () => {
		expect(expectCode(SOCIAL_PLATFORM.INSTAGRAM, "https://instagram.com:pw@evil.example/x")).toBe(
			PUBLIC_PROFILE_ERROR.SOCIAL_URL_INSECURE
		);
	});

	it("rejects a deep path that is not a profile", () => {
		expect(expectCode(SOCIAL_PLATFORM.INSTAGRAM, "https://instagram.com/p/Cabc123/")).toBe(
			PUBLIC_PROFILE_ERROR.SOCIAL_URL_INVALID
		);
	});
});

describe("normalizeSocialInput", () => {
	it("expands a bare handle so a manager can type what they know", () => {
		expect(normalizeSocialInput(SOCIAL_PLATFORM.INSTAGRAM, "@lacocina")).toBe(
			"https://instagram.com/lacocina"
		);
		expect(normalizeSocialInput(SOCIAL_PLATFORM.TIKTOK, "lacocina")).toBe(
			"https://tiktok.com/@lacocina"
		);
		expect(normalizeSocialInput(SOCIAL_PLATFORM.YOUTUBE, "@lacocina")).toBe(
			"https://youtube.com/@lacocina"
		);
	});

	it("leaves anything URL-shaped alone", () => {
		expect(normalizeSocialInput(SOCIAL_PLATFORM.INSTAGRAM, "instagram.com/lacocina")).toBe(
			"instagram.com/lacocina"
		);
	});

	it("round-trips through normalizeSocialUrl", () => {
		for (const platform of SOCIAL_PLATFORMS) {
			const expanded = normalizeSocialInput(platform, "@lacocina");
			expect(normalizeSocialUrl(platform, expanded).ok).toBe(true);
		}
	});
});

describe("normalizeRestaurantPhone", () => {
	it("strips the separators people type", () => {
		expect(normalizeRestaurantPhone("+52 81 1234 5678")).toEqual({
			ok: true,
			value: "+528112345678",
		});
		expect(normalizeRestaurantPhone("+52 (81) 1234-5678")).toEqual({
			ok: true,
			value: "+528112345678",
		});
	});

	it("treats a leading 00 as the international prefix", () => {
		expect(normalizeRestaurantPhone("0052 81 1234 5678")).toEqual({
			ok: true,
			value: "+528112345678",
		});
	});

	it("asks for a country code instead of inferring one", () => {
		// Inferring +52 here would silently mis-route every non-Mexican restaurant.
		expect(normalizeRestaurantPhone("81 1234 5678")).toEqual({
			ok: false,
			code: PUBLIC_PROFILE_ERROR.PHONE_COUNTRY_CODE_REQUIRED,
		});
	});

	it("rejects lengths outside E.164 and country codes starting with zero", () => {
		expect(normalizeRestaurantPhone("+52812345678901234")).toEqual({
			ok: false,
			code: PUBLIC_PROFILE_ERROR.PHONE_INVALID,
		});
		expect(normalizeRestaurantPhone("+1234")).toEqual({
			ok: false,
			code: PUBLIC_PROFILE_ERROR.PHONE_INVALID,
		});
		expect(normalizeRestaurantPhone("+0528112345678")).toEqual({
			ok: false,
			code: PUBLIC_PROFILE_ERROR.PHONE_INVALID,
		});
	});

	it("rejects text", () => {
		expect(normalizeRestaurantPhone("call us!")).toEqual({
			ok: false,
			code: PUBLIC_PROFILE_ERROR.PHONE_INVALID,
		});
	});

	it("treats an empty value as a successful clear", () => {
		expect(normalizeRestaurantPhone("  ")).toEqual({ ok: true, value: "" });
	});
});

describe("phone hrefs", () => {
	it("keeps the + on tel:, which is what makes it dialable from abroad", () => {
		expect(toTelHref("+528112345678")).toBe("tel:+528112345678");
	});

	it("drops the + for wa.me, which takes digits only", () => {
		expect(toWhatsAppUrl("+528112345678")).toBe("https://wa.me/528112345678");
	});

	it("returns null rather than a wrong link when the stored value is not E.164", () => {
		expect(toWhatsAppUrl("8112345678")).toBeNull();
		expect(toWhatsAppUrl("")).toBeNull();
	});
});

describe("registry integrity", () => {
	it("maps every platform to a distinct column", () => {
		const fields = SOCIAL_PLATFORMS.map((p) => SOCIAL_FIELD[p]);
		expect(new Set(fields).size).toBe(SOCIAL_PLATFORMS.length);
	});

	it("lists every platform exactly once", () => {
		expect([...SOCIAL_PLATFORMS].sort()).toEqual(Object.values(SOCIAL_PLATFORM).sort());
	});
});

describe("isValidContactEmail", () => {
	it("accepts an ordinary address and rejects obvious junk", () => {
		expect(isValidContactEmail("hola@lacocina.mx")).toBe(true);
		expect(isValidContactEmail("hola@lacocina")).toBe(false);
		expect(isValidContactEmail("hola lacocina.mx")).toBe(false);
	});
});

describe("MAX_ADDRESS_LENGTH", () => {
	it("is generous enough for a real street address", () => {
		expect(MAX_ADDRESS_LENGTH).toBeGreaterThan(120);
	});
});
