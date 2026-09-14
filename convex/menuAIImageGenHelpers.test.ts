import { describe, expect, it } from "vitest";
import {
	MENU_AI_IMAGE_FAILURE,
	MENU_AI_IMAGE_JOB_STATUS,
	MENU_AI_IMAGE_STALE_JOB_MS,
} from "./constants";
import {
	buildDishImagePrompt,
	classifyHttpFailure,
	countsTowardMonthlyCap,
	decodeImageResponse,
	DISH_IMAGE_STYLE_BRIEF,
	monthStartUtc,
	readJpegDimensions,
	retryDelayMs,
} from "./menuAIImageGenHelpers";

describe("buildDishImagePrompt", () => {
	it("names the dish, the category, the restaurant, and the fixed style brief", () => {
		const prompt = buildDishImagePrompt({
			name: "Rib eye",
			description: "un delicioso corte de lomo de res",
			categoryName: "Carnes",
			restaurantName: "Vernaculo",
		});
		expect(prompt).toBe(
			`Professional restaurant food photograph of Rib eye: un delicioso corte de lomo de res. A Carnes dish served at Vernaculo. ${DISH_IMAGE_STYLE_BRIEF}`
		);
	});

	it("omits the description clause when there is none", () => {
		const prompt = buildDishImagePrompt({
			name: "Agua",
			categoryName: "Bebidas",
			restaurantName: "V",
		});
		expect(
			prompt.startsWith("Professional restaurant food photograph of Agua. A Bebidas dish")
		).toBe(true);
	});

	// Dish text is the only user-controlled input; keep it short and flat so a
	// pasted paragraph cannot become the prompt.
	it("collapses whitespace and caps each field", () => {
		const prompt = buildDishImagePrompt({
			name: "  Tacos\n\n al  pastor  " + "x".repeat(200),
			description: "y".repeat(500),
			categoryName: "c".repeat(100),
			restaurantName: "r".repeat(100),
		});
		expect(prompt).not.toMatch(/\n| {2}/);
		expect(prompt).toContain("Tacos al pastor " + "x".repeat(80 - "Tacos al pastor ".length));
		expect(prompt).toContain("y".repeat(300));
		expect(prompt).not.toContain("y".repeat(301));
		expect(prompt).toContain("c".repeat(60));
		expect(prompt).not.toContain("c".repeat(61));
	});
});

describe("decodeImageResponse", () => {
	const b64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

	it("decodes one jpeg with its cost", () => {
		const result = decodeImageResponse({
			created: 1,
			data: [{ b64_json: b64, media_type: "image/jpeg" }],
			usage: { cost: 0.039 },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(Array.from(result.image.bytes)).toEqual([0xff, 0xd8, 0xff, 0xd9]);
		expect(result.image.mediaType).toBe("image/jpeg");
		expect(result.image.costUsd).toBe(0.039);
	});

	it("reports a missing image", () => {
		expect(decodeImageResponse({ data: [] })).toEqual({ ok: false, reason: "no_image" });
		expect(decodeImageResponse({})).toEqual({ ok: false, reason: "no_image" });
	});

	it("refuses a non-raster media type", () => {
		expect(decodeImageResponse({ data: [{ b64_json: b64, media_type: "image/svg+xml" }] })).toEqual(
			{ ok: false, reason: "unsupported_media_type" }
		);
	});

	it("reports malformed base64 and non-object bodies", () => {
		expect(decodeImageResponse({ data: [{ b64_json: "%%%", media_type: "image/png" }] })).toEqual({
			ok: false,
			reason: "malformed",
		});
		expect(decodeImageResponse(null)).toEqual({ ok: false, reason: "no_image" });
	});

	it("refuses more than one image (the spec asks for exactly one)", () => {
		expect(
			decodeImageResponse({
				data: [
					{ b64_json: b64, media_type: "image/jpeg" },
					{ b64_json: b64, media_type: "image/jpeg" },
				],
			})
		).toEqual({ ok: false, reason: "malformed" });
	});

	it("leaves cost null when usage is absent", () => {
		const result = decodeImageResponse({ data: [{ b64_json: b64, media_type: "image/webp" }] });
		expect(result.ok && result.image.costUsd).toBeNull();
	});
});

describe("readJpegDimensions", () => {
	it("reads width and height from the SOF0 marker", () => {
		// SOI, SOF0 (length 11, precision 8, height 0x0001, width 0x0002, 1 component), EOI
		const bytes = new Uint8Array([
			0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x02, 0x01, 0x01, 0x11, 0x00,
			0xff, 0xd9,
		]);
		expect(readJpegDimensions(bytes)).toEqual({ width: 2, height: 1 });
	});

	it("skips non-SOF segments to find the frame header", () => {
		// SOI, APP0 (length 4, two payload bytes), SOF2 with 3x4, EOI
		const bytes = new Uint8Array([
			0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc2, 0x00, 0x0b, 0x08, 0x00, 0x04,
			0x00, 0x03, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
		]);
		expect(readJpegDimensions(bytes)).toEqual({ width: 3, height: 4 });
	});

	it("returns null for anything that is not a JPEG", () => {
		expect(readJpegDimensions(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
		expect(readJpegDimensions(new Uint8Array([]))).toBeNull();
	});
});

describe("classifyHttpFailure", () => {
	it("treats 402 as exhausted credits, never retried", () => {
		expect(classifyHttpFailure(402)).toEqual({
			code: MENU_AI_IMAGE_FAILURE.CREDITS_EXHAUSTED,
			retry: false,
		});
	});
	it("retries 429 and 5xx", () => {
		expect(classifyHttpFailure(429)).toEqual({
			code: MENU_AI_IMAGE_FAILURE.RATE_LIMITED,
			retry: true,
		});
		expect(classifyHttpFailure(502)).toEqual({
			code: MENU_AI_IMAGE_FAILURE.PROVIDER_ERROR,
			retry: true,
		});
	});
	it("does not retry other 4xx", () => {
		expect(classifyHttpFailure(400)).toEqual({
			code: MENU_AI_IMAGE_FAILURE.PROVIDER_ERROR,
			retry: false,
		});
	});
});

describe("retryDelayMs", () => {
	it("backs off exponentially from two seconds", () => {
		expect([0, 1, 2].map(retryDelayMs)).toEqual([2000, 4000, 8000]);
	});
});

describe("monthStartUtc", () => {
	it("returns the first instant of the UTC month", () => {
		expect(monthStartUtc(Date.UTC(2026, 8, 13, 23, 59))).toBe(Date.UTC(2026, 8, 1));
		expect(monthStartUtc(Date.UTC(2026, 0, 1, 0, 0, 1))).toBe(Date.UTC(2026, 0, 1));
	});
});

describe("countsTowardMonthlyCap", () => {
	const NOW = Date.UTC(2026, 8, 13, 12, 0, 0);

	it("counts a done job", () => {
		expect(
			countsTowardMonthlyCap({ status: MENU_AI_IMAGE_JOB_STATUS.DONE, createdAt: NOW }, NOW)
		).toBe(true);
	});

	it("counts a fresh queued or running job", () => {
		expect(
			countsTowardMonthlyCap({ status: MENU_AI_IMAGE_JOB_STATUS.QUEUED, createdAt: NOW }, NOW)
		).toBe(true);
		expect(
			countsTowardMonthlyCap(
				{ status: MENU_AI_IMAGE_JOB_STATUS.RUNNING, createdAt: NOW, startedAt: NOW },
				NOW
			)
		).toBe(true);
	});

	it("does not count a stale queued or running job", () => {
		const staleStart = NOW - MENU_AI_IMAGE_STALE_JOB_MS;
		expect(
			countsTowardMonthlyCap(
				{ status: MENU_AI_IMAGE_JOB_STATUS.RUNNING, createdAt: staleStart, startedAt: staleStart },
				NOW
			)
		).toBe(false);
		// No startedAt yet (still queued): falls back to createdAt.
		expect(
			countsTowardMonthlyCap(
				{ status: MENU_AI_IMAGE_JOB_STATUS.QUEUED, createdAt: staleStart },
				NOW
			)
		).toBe(false);
	});

	it("counts a failed job only when it may have been billed (invalid_response or timeout)", () => {
		expect(
			countsTowardMonthlyCap(
				{
					status: MENU_AI_IMAGE_JOB_STATUS.FAILED,
					error: MENU_AI_IMAGE_FAILURE.INVALID_RESPONSE,
					createdAt: NOW,
				},
				NOW
			)
		).toBe(true);
		expect(
			countsTowardMonthlyCap(
				{
					status: MENU_AI_IMAGE_JOB_STATUS.FAILED,
					error: MENU_AI_IMAGE_FAILURE.TIMEOUT,
					createdAt: NOW,
				},
				NOW
			)
		).toBe(true);
	});

	it("does not count a failed job for any other reason", () => {
		for (const error of [
			MENU_AI_IMAGE_FAILURE.CREDITS_EXHAUSTED,
			MENU_AI_IMAGE_FAILURE.RATE_LIMITED,
			MENU_AI_IMAGE_FAILURE.PROVIDER_ERROR,
			MENU_AI_IMAGE_FAILURE.ITEM_MISSING,
		]) {
			expect(
				countsTowardMonthlyCap(
					{ status: MENU_AI_IMAGE_JOB_STATUS.FAILED, error, createdAt: NOW },
					NOW
				)
			).toBe(false);
		}
	});
});
