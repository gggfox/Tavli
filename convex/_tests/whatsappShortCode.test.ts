import { describe, expect, it } from "vitest";
import {
	buildDeepLinkText,
	buildDeepLinkUrl,
	deriveShortCodePrefix,
	extractShortCodeCandidates,
	formatShortCode,
	generateShortCode,
	isShortCodeShape,
	normalizeShortCode,
	stripShortCode,
} from "../whatsapp/shortCode";
import { WHATSAPP_LOCALE, WHATSAPP_SHORT_CODE_MAX_CANDIDATES } from "../constants";

/**
 * The short code is a ROUTER, not a secret (ADR 012). These tests pin the two
 * properties that make it usable: it reads like a booking reference, and it can
 * be pulled back out of a sentence a diner may have edited — without matching
 * ordinary words, which is what would turn a router into a guessing game.
 */
describe("deriveShortCodePrefix", () => {
	it("reads as an abbreviation of the restaurant name", () => {
		expect(deriveShortCodePrefix("Vernáculo")).toBe("VRN");
		expect(deriveShortCodePrefix("Taquería El Sol")).toBe("TQR");
	});

	it("folds diacritics rather than dropping the letter", () => {
		// "Ñoño" must not collapse to "N" — the tilde is a diacritic, not a gap.
		expect(deriveShortCodePrefix("Ñoño")).toBe("NN");
	});

	it("returns what it can when the name has fewer than three usable letters", () => {
		expect(deriveShortCodePrefix("Ox")).toBe("OX");
		expect(deriveShortCodePrefix("寿司")).toBe("");
		expect(deriveShortCodePrefix("")).toBe("");
	});
});

describe("generateShortCode", () => {
	// Deterministic RNG: a router does not need entropy ceremony, and a seeded
	// sequence is what lets these assertions be exact.
	function seededRandom(values: number[]): () => number {
		let i = 0;
		return () => values[i++ % values.length];
	}

	it("prefixes with the name abbreviation and suffixes from the code alphabet", () => {
		const code = generateShortCode("Vernáculo", seededRandom([0, 0, 0, 0]));
		expect(code.startsWith("VRN")).toBe(true);
		expect(code).toHaveLength(6);
	});

	it("always contains a digit, so it never reads as an ordinary word", () => {
		for (let seed = 0; seed < 32; seed++) {
			const code = generateShortCode("Restaurante", seededRandom([seed / 32]));
			expect(code).toMatch(/[0-9]/);
			expect(isShortCodeShape(code)).toBe(true);
		}
	});

	it("pads a name too short to abbreviate so the code is always full length", () => {
		const code = generateShortCode("寿司", seededRandom([0.5, 0.1, 0.9, 0.3, 0.7, 0.2]));
		expect(code).toHaveLength(6);
		expect(isShortCodeShape(code)).toBe(true);
	});

	it("excludes characters that are read wrong off a printed card", () => {
		// O/0 and I/1 are the classic misreads on a table tent.
		for (let seed = 0; seed < 64; seed++) {
			const suffix = generateShortCode("Bar", seededRandom([seed / 64])).slice(3);
			expect(suffix).not.toMatch(/[OI01]/);
		}
	});
});

describe("normalizeShortCode / formatShortCode", () => {
	it("accepts what a human retypes and stores one canonical form", () => {
		expect(normalizeShortCode("vrn-8f3")).toBe("VRN8F3");
		expect(normalizeShortCode("VRN 8F3")).toBe("VRN8F3");
		expect(normalizeShortCode(" vrn8f3 ")).toBe("VRN8F3");
	});

	it("formats the canonical form as the hyphenated reference people read aloud", () => {
		expect(formatShortCode("VRN8F3")).toBe("VRN-8F3");
	});
});

describe("extractShortCodeCandidates", () => {
	it("finds the code in the prefilled deep-link sentence", () => {
		expect(
			extractShortCodeCandidates("Hola, quiero información sobre Vernáculo · VRN-8F3")
		).toEqual(["VRN8F3"]);
	});

	it("finds it whether the diner kept the hyphen, a space, or neither", () => {
		expect(extractShortCodeCandidates("hola vrn 8f3")).toEqual(["VRN8F3"]);
		expect(extractShortCodeCandidates("hola vrn8f3")).toEqual(["VRN8F3"]);
	});

	it("does not treat ordinary six-letter words as codes", () => {
		// Without the digit rule, "quiero" and "cuenta" both match a 3+3 shape and
		// every message would hit the router table.
		expect(extractShortCodeCandidates("Hola, quiero reservar una mesa")).toEqual([]);
		expect(extractShortCodeCandidates("¿me pasas la cuenta?")).toEqual([]);
		expect(extractShortCodeCandidates("")).toEqual([]);
	});

	it("returns every candidate so the database, not a name match, picks the route", () => {
		// "Bar 4to" has the code shape by accident; the real code must still be
		// tried rather than swallowed by whatever matched first.
		const candidates = extractShortCodeCandidates("Bar 4to · VRN-8F3");
		expect(candidates).toContain("VRN8F3");
		expect(candidates).toContain("BAR4TO");
	});

	it("caps how many candidates one message can produce", () => {
		const noisy = Array.from({ length: 20 }, (_, i) => `ABC${i % 8}D2`).join(" ");
		expect(extractShortCodeCandidates(noisy).length).toBeLessThanOrEqual(
			WHATSAPP_SHORT_CODE_MAX_CANDIDATES
		);
	});
});

describe("stripShortCode", () => {
	it("removes the code and the separator dot it was decorated with", () => {
		expect(stripShortCode("Hola, quiero información sobre Vernáculo · VRN-8F3", "VRN8F3")).toBe(
			"Hola, quiero información sobre Vernáculo"
		);
	});

	it("removes it wherever the diner left it, in any of its written forms", () => {
		expect(stripShortCode("VRN-8F3 hola", "VRN8F3")).toBe("hola");
		expect(stripShortCode("hola vrn 8f3 gracias", "VRN8F3")).toBe("hola gracias");
	});

	it("reduces a message that was only the code to nothing", () => {
		expect(stripShortCode("VRN-8F3", "VRN8F3")).toBe("");
		expect(stripShortCode(" · vrn8f3 ", "VRN8F3")).toBe("");
	});

	it("leaves a message that does not carry the code untouched", () => {
		expect(stripShortCode("Hola, ¿tienen mesa?", "VRN8F3")).toBe("Hola, ¿tienen mesa?");
	});

	it("keeps the diner's line breaks — only our own token's gap is collapsed", () => {
		expect(stripShortCode("Hola VRN-8F3\n¿tienen mesa?\npara 4", "VRN8F3")).toBe(
			"Hola\n¿tienen mesa?\npara 4"
		);
	});
});

describe("deep link", () => {
	it("reads like a sentence, because WhatsApp shows it in the diner's message box", () => {
		const text = buildDeepLinkText("Vernáculo", "VRN8F3", WHATSAPP_LOCALE.ES);
		expect(text).toBe("Hola, quiero información sobre Vernáculo · VRN-8F3");
		expect(buildDeepLinkText("Vernáculo", "VRN8F3", WHATSAPP_LOCALE.EN)).toContain("VRN-8F3");
	});

	it("round-trips: what the deep link prefills is what the router reads back", () => {
		const text = buildDeepLinkText("Vernáculo", "VRN8F3", WHATSAPP_LOCALE.ES);
		expect(extractShortCodeCandidates(text)).toContain("VRN8F3");
		expect(stripShortCode(text, "VRN8F3")).toBe("Hola, quiero información sobre Vernáculo");
	});

	it("builds a wa.me url with the Tavli number and the prefilled text", () => {
		const url = buildDeepLinkUrl("+14155238886", "Vernáculo", "VRN8F3", WHATSAPP_LOCALE.ES);
		expect(url).not.toBeNull();
		expect(url!.startsWith("https://wa.me/14155238886?text=")).toBe(true);
		const text = new URL(url!).searchParams.get("text");
		expect(text).toBe("Hola, quiero información sobre Vernáculo · VRN-8F3");
	});

	it("returns null without a configured Tavli number rather than a broken link", () => {
		expect(buildDeepLinkUrl(undefined, "Vernáculo", "VRN8F3", WHATSAPP_LOCALE.ES)).toBeNull();
		expect(buildDeepLinkUrl("", "Vernáculo", "VRN8F3", WHATSAPP_LOCALE.ES)).toBeNull();
	});
});
