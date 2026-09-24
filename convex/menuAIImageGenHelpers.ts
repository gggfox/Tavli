/**
 * Pure pieces of AI menu image generation (workstream B): everything that can
 * be tested without Convex or the network.
 */
import {
	MENU_AI_IMAGE_FAILURE,
	MENU_AI_IMAGE_JOB_STATUS,
	MENU_AI_IMAGE_STALE_JOB_MS,
	type MenuAIImageFailure,
} from "./constants";

export const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images";

/**
 * The one house style for every image on a menu. It is a constant so images
 * look like one shoot, and the exact prompt is stored on every draft so a
 * change here can be compared against history.
 */
export const DISH_IMAGE_STYLE_BRIEF =
	"Plated on a simple ceramic plate, shot from a 45-degree angle, soft natural light, " +
	"shallow depth of field, neutral wooden table, appetizing and realistic. " +
	"No text, no logos, no people, no hands, no watermark.";

const NAME_MAX = 80;
const DESCRIPTION_MAX = 300;
const OTHER_MAX = 60;

function clean(value: string | undefined, max: number): string {
	return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Dish name and description are the only user-controlled text that reaches
 * the model; they are flattened and capped so a pasted paragraph cannot take
 * the prompt over.
 */
export function buildDishImagePrompt(input: {
	name: string;
	description?: string;
	categoryName: string;
	restaurantName: string;
}): string {
	const name = clean(input.name, NAME_MAX);
	const description = clean(input.description, DESCRIPTION_MAX);
	const category = clean(input.categoryName, OTHER_MAX);
	const restaurant = clean(input.restaurantName, OTHER_MAX);
	const subject = description ? `${name}: ${description}` : name;
	return `Professional restaurant food photograph of ${subject}. A ${category} dish served at ${restaurant}. ${DISH_IMAGE_STYLE_BRIEF}`;
}

export type DecodedImage = {
	bytes: Uint8Array<ArrayBuffer>;
	mediaType: string;
	costUsd: number | null;
};
export type DecodeResult =
	| { ok: true; image: DecodedImage }
	| { ok: false; reason: "no_image" | "unsupported_media_type" | "malformed" };

const RASTER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Parse an OpenRouter `/images` body: exactly one raster image in `data[0]`. */
export function decodeImageResponse(body: unknown): DecodeResult {
	if (typeof body !== "object" || body === null) return { ok: false, reason: "no_image" };
	const data = (body as { data?: unknown }).data;
	// The spec asks OpenRouter for exactly one image (`n: 1`); more than one
	// back is not something the caller asked for and is treated as malformed
	// rather than silently taking the first.
	if (Array.isArray(data) && data.length > 1) return { ok: false, reason: "malformed" };
	const first = Array.isArray(data) ? data[0] : undefined;
	if (typeof first !== "object" || first === null) return { ok: false, reason: "no_image" };
	const { b64_json: b64, media_type: mediaType } = first as {
		b64_json?: unknown;
		media_type?: unknown;
	};
	if (typeof b64 !== "string" || b64.length === 0) return { ok: false, reason: "no_image" };
	if (typeof mediaType !== "string" || !RASTER_TYPES.has(mediaType)) {
		return { ok: false, reason: "unsupported_media_type" };
	}
	let bytes: Uint8Array<ArrayBuffer>;
	try {
		if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw new Error("not base64");
		const binary = atob(b64.replace(/\s/g, ""));
		// `Uint8Array.from` types its result as `Uint8Array<ArrayBufferLike>`
		// (it could in principle back onto a `SharedArrayBuffer`), but it never
		// actually does — this cast tells the compiler what is already true at
		// runtime, once, here, so every caller of `decodeImageResponse` gets the
		// narrower `Uint8Array<ArrayBuffer>` `BlobPart` needs for free.
		bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
	} catch {
		return { ok: false, reason: "malformed" };
	}
	const usage = (body as { usage?: { cost?: unknown } }).usage;
	const costUsd = typeof usage?.cost === "number" ? usage.cost : null;
	return { ok: true, image: { bytes, mediaType, costUsd } };
}

/**
 * Width and height from a JPEG's frame header (SOFn), best effort. Walks the
 * segments after SOI; returns null for anything that is not a JPEG or has no
 * frame header before the scan starts.
 */
export function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	let offset = 2;
	while (offset + 3 < bytes.length) {
		if (bytes[offset] !== 0xff) return null;
		const marker = bytes[offset + 1];
		// Standalone markers carry no length.
		if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			offset += 2;
			continue;
		}
		if (marker === 0xd9 || marker === 0xda) return null; // EOI / start of scan without SOF
		const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
		const isSof =
			marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
		if (isSof) {
			if (offset + 8 >= bytes.length) return null;
			const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
			const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
			return width > 0 && height > 0 ? { width, height } : null;
		}
		offset += 2 + length;
	}
	return null;
}

/**
 * Whether an OpenRouter error body is a moderation refusal. OpenRouter passes
 * the upstream verdict through as `error.metadata.block_reason` (Gemini sends
 * `"SAFETY"`), e.g. for "Sopa de almeja", whose name is also Spanish slang.
 */
export function isModerationBlock(body: unknown): boolean {
	if (typeof body !== "object" || body === null) return false;
	const error = (body as { error?: unknown }).error;
	if (typeof error !== "object" || error === null) return false;
	const { message, metadata } = error as { message?: unknown; metadata?: unknown };
	const blockReason =
		typeof metadata === "object" && metadata !== null
			? (metadata as { block_reason?: unknown }).block_reason
			: undefined;
	if (typeof blockReason === "string" && blockReason.length > 0) return true;
	return typeof message === "string" && /moderation/i.test(message);
}

/**
 * 402 is a credits problem nothing here can fix; a moderation refusal will
 * refuse the same prompt again; 429 and 5xx are worth a retry.
 */
export function classifyHttpFailure(
	status: number,
	body?: unknown
): { code: MenuAIImageFailure; retry: boolean } {
	if (status === 402) return { code: MENU_AI_IMAGE_FAILURE.CREDITS_EXHAUSTED, retry: false };
	if (status === 429) return { code: MENU_AI_IMAGE_FAILURE.RATE_LIMITED, retry: true };
	if (status >= 500) return { code: MENU_AI_IMAGE_FAILURE.PROVIDER_ERROR, retry: true };
	if (isModerationBlock(body)) return { code: MENU_AI_IMAGE_FAILURE.CONTENT_BLOCKED, retry: false };
	return { code: MENU_AI_IMAGE_FAILURE.PROVIDER_ERROR, retry: false };
}

export function retryDelayMs(retries: number): number {
	return 2000 * 2 ** retries;
}

/** First instant of the UTC calendar month containing `nowMs`. */
export function monthStartUtc(nowMs: number): number {
	const d = new Date(nowMs);
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** The subset of a job row `countsTowardMonthlyCap` needs. */
export type MonthlyCapJob = {
	status: string;
	error?: string;
	startedAt?: number;
	createdAt: number;
};

/**
 * Whether a job counts against the organization's monthly generation cap.
 *
 * - `done` always counts: an image was produced and (usually) billed.
 * - `queued`/`running` counts only while fresh — a stale one (older than
 *   `MENU_AI_IMAGE_STALE_JOB_MS`) is dead and must not hold a unit of the cap
 *   forever; the next `startGeneration` call marks it failed anyway.
 * - `failed` counts only for `invalid_response` and `timeout`: the provider
 *   may have generated (and billed for) an image in both cases even though
 *   Tavli could not use it. Every other failure reason (credits exhausted,
 *   rate limited, content blocked, provider error, item missing) never reached — or never
 *   billed — generation, so it costs nothing and does not count.
 */
export function countsTowardMonthlyCap(job: MonthlyCapJob, now: number): boolean {
	if (job.status === MENU_AI_IMAGE_JOB_STATUS.DONE) return true;
	if (
		job.status === MENU_AI_IMAGE_JOB_STATUS.QUEUED ||
		job.status === MENU_AI_IMAGE_JOB_STATUS.RUNNING
	) {
		return now - (job.startedAt ?? job.createdAt) < MENU_AI_IMAGE_STALE_JOB_MS;
	}
	if (job.status === MENU_AI_IMAGE_JOB_STATUS.FAILED) {
		return (
			job.error === MENU_AI_IMAGE_FAILURE.INVALID_RESPONSE ||
			job.error === MENU_AI_IMAGE_FAILURE.TIMEOUT
		);
	}
	return false;
}
