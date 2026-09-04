import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	BRANDING_IMAGE_SLOTS,
	BRANDING_SLOT_SPECS,
	checkBrandingImage,
	readWebpDimensions,
	sniffImageFormat,
	type BrandingImageSlot,
} from "./brandingImageHelpers";

/**
 * Fixtures are **real encoder output**, not hand-assembled headers.
 *
 * Hand-built bytes test the parser against my reading of the spec, which is
 * the same reading that produced the parser — so they agree by construction
 * and prove nothing. These come from `cwebp` and `ffmpeg` and cover all three
 * WebP container flavours a browser can emit, which is the distinction that
 * actually bit: a parser handling only `VP8X` rejects the lossy files most
 * browsers produce for a photo, and a header image is a photo.
 *
 * Regenerate with `convex/_tests/fixtures/branding/README.md`.
 */
const FIXTURES = join(__dirname, "_tests/fixtures/branding");
const load = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, name)));

const LOGO_PNG = load("logo-512.png");
const HEADER_VP8 = load("header-desktop-1600x900.webp");
const HEADER_VP8L = load("header-tablet-1024x576-lossless.webp");
const HEADER_VP8X = load("header-phone-768x432-vp8x.webp");
const WRONG_SIZE = load("wrong-size-800x600.webp");

describe("sniffImageFormat", () => {
	it("recognises real PNG and WebP", () => {
		expect(sniffImageFormat(LOGO_PNG)).toBe("png");
		for (const webp of [HEADER_VP8, HEADER_VP8L, HEADER_VP8X]) {
			expect(sniffImageFormat(webp)).toBe("webp");
		}
	});

	it("rejects SVG however it is dressed up", () => {
		// SVG is rejected *by construction* — there is no signature for it in
		// the allowlist. A denylist would have to anticipate every one of these
		// prefixes, and would ship with whichever one nobody thought of.
		const svgs = [
			'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
			'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>',
			'﻿<svg xmlns="http://www.w3.org/2000/svg"/>',
			'   \n\t<svg xmlns="http://www.w3.org/2000/svg"/>',
			'<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>',
			'<!-- a comment --><svg xmlns="http://www.w3.org/2000/svg"/>',
		];
		for (const svg of svgs) {
			expect(sniffImageFormat(new TextEncoder().encode(svg)), svg.slice(0, 24)).toBeNull();
		}
	});

	it("rejects other real formats and junk", () => {
		// GIF, JPEG and a bare RIFF that is not WebP (e.g. a .wav).
		expect(sniffImageFormat(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeNull();
		expect(sniffImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
		const riffWave = new Uint8Array(16);
		riffWave.set([0x52, 0x49, 0x46, 0x46], 0);
		riffWave.set([0x57, 0x41, 0x56, 0x45], 8);
		expect(sniffImageFormat(riffWave)).toBeNull();
		expect(sniffImageFormat(new Uint8Array(0))).toBeNull();
		expect(sniffImageFormat(new Uint8Array([0x89]))).toBeNull();
	});

	it("does not read past the end of a truncated file", () => {
		// A file that starts like a PNG and stops. Indexing past the end must
		// not throw — this runs on caller-supplied bytes.
		for (let length = 0; length < 40; length++) {
			expect(() => sniffImageFormat(LOGO_PNG.slice(0, length))).not.toThrow();
		}
	});
});

describe("dimension parsing", () => {
	it("reads every WebP container flavour a browser can emit", () => {
		// VP8 (lossy), VP8L (lossless) and VP8X (extended, what a canvas
		// toBlob with alpha produces). Each stores its size differently.
		expect(readWebpDimensions(HEADER_VP8)).toEqual({ width: 1600, height: 900 });
		expect(readWebpDimensions(HEADER_VP8L)).toEqual({ width: 1024, height: 576 });
		expect(readWebpDimensions(HEADER_VP8X)).toEqual({ width: 768, height: 432 });
	});

	it("returns null rather than throwing on truncated WebP", () => {
		for (let length = 0; length < 40; length++) {
			expect(() => readWebpDimensions(HEADER_VP8.slice(0, length))).not.toThrow();
		}
	});
});

describe("checkBrandingImage", () => {
	it("accepts a correctly-sized file for each slot", () => {
		expect(checkBrandingImage(LOGO_PNG, "logo")).toMatchObject({
			ok: true,
			format: "png",
			dimensions: { width: 512, height: 512 },
		});
		expect(checkBrandingImage(HEADER_VP8, "headerDesktop")).toMatchObject({ ok: true });
		expect(checkBrandingImage(HEADER_VP8L, "headerTablet")).toMatchObject({ ok: true });
		expect(checkBrandingImage(HEADER_VP8X, "headerPhone")).toMatchObject({ ok: true });
	});

	it("rejects an SVG renamed to .png", () => {
		// The headline case. `file.type` would say image/png; the bytes do not.
		const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
		const verdict = checkBrandingImage(svg, "logo");
		expect(verdict.ok).toBe(false);
		expect(verdict.ok === false && verdict.rejection).toMatchObject({
			reason: "wrongFormat",
			expected: "png",
			actual: null,
		});
	});

	it("rejects a WebP in the PNG slot and a PNG in a WebP slot", () => {
		expect(checkBrandingImage(HEADER_VP8, "logo")).toMatchObject({
			ok: false,
			rejection: { reason: "wrongFormat", expected: "png", actual: "webp" },
		});
		expect(checkBrandingImage(LOGO_PNG, "headerDesktop")).toMatchObject({
			ok: false,
			rejection: { reason: "wrongFormat", expected: "webp", actual: "png" },
		});
	});

	it("rejects the right size in the wrong slot", () => {
		// A desktop header uploaded to the phone slot: correct format, correct
		// aspect, three times the bytes the phone budget allows.
		expect(checkBrandingImage(HEADER_VP8, "headerPhone")).toMatchObject({
			ok: false,
			rejection: { reason: "wrongDimensions" },
		});
	});

	it("rejects arbitrary dimensions", () => {
		const verdict = checkBrandingImage(WRONG_SIZE, "headerDesktop");
		expect(verdict.ok).toBe(false);
		expect(verdict.ok === false && verdict.rejection).toMatchObject({
			reason: "wrongDimensions",
			expected: { width: 1600, height: 900 },
			actual: { width: 800, height: 600 },
		});
	});

	it("checks the byte cap before it parses anything", () => {
		// A hostile 50 MB upload must be refused by a length comparison, not
		// by a header parser walking into it.
		const huge = new Uint8Array(50 * 1024 * 1024);
		const verdict = checkBrandingImage(huge, "logo");
		expect(verdict.ok).toBe(false);
		expect(verdict.ok === false && verdict.rejection.reason).toBe("tooLarge");
	});

	it("never throws, whatever the bytes are", () => {
		// This runs on input from an authenticated but otherwise untrusted
		// caller. A throw here is a 500 where a rejection belongs.
		const nasty = [
			new Uint8Array(0),
			new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
			LOGO_PNG.slice(0, 20),
			HEADER_VP8.slice(0, 25),
			new Uint8Array(64).fill(0xff),
		];
		for (const slot of BRANDING_IMAGE_SLOTS) {
			for (const bytes of nasty) {
				expect(() => checkBrandingImage(bytes, slot)).not.toThrow();
			}
		}
	});
});

describe("slot specs", () => {
	it("covers every slot", () => {
		for (const slot of BRANDING_IMAGE_SLOTS) {
			expect(BRANDING_SLOT_SPECS[slot], slot).toBeDefined();
		}
	});

	it("shrinks the byte cap as the pixel count falls", () => {
		// Otherwise the phone slot silently carries a desktop-weight file and
		// the whole point of three slots — fewer bytes on the small screen —
		// is lost with nothing failing.
		const headers: BrandingImageSlot[] = ["headerDesktop", "headerTablet", "headerPhone"];
		for (let i = 1; i < headers.length; i++) {
			const bigger = BRANDING_SLOT_SPECS[headers[i - 1]];
			const smaller = BRANDING_SLOT_SPECS[headers[i]];
			expect(smaller.width).toBeLessThan(bigger.width);
			expect(smaller.maxBytes).toBeLessThan(bigger.maxBytes);
		}
	});

	it("keeps the three header slots at one aspect ratio", () => {
		// They are `<source media>` siblings in one `<picture>`. Different
		// aspect ratios would shift the layout at a breakpoint — the exact CLS
		// the stored dimensions exist to prevent.
		const ratios = (["headerDesktop", "headerTablet", "headerPhone"] as const).map((slot) => {
			const spec = BRANDING_SLOT_SPECS[slot];
			return spec.width / spec.height;
		});
		for (const ratio of ratios) expect(ratio).toBeCloseTo(16 / 9, 3);
	});

	it("names three distinct columns per slot", () => {
		// A copy-paste that leaves two slots sharing a storageId column makes
		// one upload overwrite another's blob reference, orphaning the file.
		const seen = new Set<string>();
		for (const slot of BRANDING_IMAGE_SLOTS) {
			for (const column of Object.values(BRANDING_SLOT_SPECS[slot].columns)) {
				expect(seen.has(column), `${column} is used by more than one slot`).toBe(false);
				seen.add(column);
			}
		}
		expect(seen.size).toBe(BRANDING_IMAGE_SLOTS.length * 3);
	});
});
