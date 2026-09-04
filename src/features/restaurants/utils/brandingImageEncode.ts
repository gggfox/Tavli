/**
 * Client-side encoding for branding uploads (TAVLI-96, ADR 009).
 *
 * The manager picks one file; this turns it into the exact bytes each slot
 * accepts. The server re-checks everything — this is a convenience layer, not
 * a trust boundary, and it is written so that its failure mode is a rejected
 * upload rather than a bad one.
 *
 * ## Why `createImageBitmap(file, { imageOrientation: "from-image" })`
 *
 * A phone photo is almost always stored landscape with an EXIF `Orientation`
 * tag saying "rotate me". Drawing such a file to a canvas *ignores* that tag,
 * so a portrait photo arrives on its side — and because the canvas round-trip
 * discards EXIF, it stays that way forever with no tag left to fix it.
 * `imageOrientation: "from-image"` applies the rotation while decoding, so the
 * pixels come out the way the photographer saw them.
 *
 * That discarded EXIF is also a **privacy property worth keeping**: a phone
 * photo of a dining room carries GPS coordinates, a device serial and a
 * timestamp, and a header image is served to anonymous diners. The round-trip
 * strips all of it. Do not "improve" this by preserving metadata.
 */
import { BRANDING_SLOT_SPECS, type BrandingImageSlot } from "convex/brandingImageHelpers";

/** Quality ladder tried in order until the encoded blob fits its byte cap. */
const QUALITY_STEPS = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5] as const;

export type BrandingEncodeFailure =
	| { reason: "decodeFailed" }
	| { reason: "encodeFailed" }
	| { reason: "tooLargeAtLowestQuality"; bytes: number; limitBytes: number };

export type BrandingEncodeResult =
	| { ok: true; bytes: ArrayBuffer; width: number; height: number }
	| { ok: false; failure: BrandingEncodeFailure };

/**
 * Draw `source` into a slot-sized canvas, cover-cropped and centred.
 *
 * Cover rather than contain: a header image is a background, and letterboxing
 * it would put bars of arbitrary colour on the one screen this feature exists
 * to make feel like the restaurant's. The logo slot is the exception and is
 * handled by {@link drawContain}.
 */
function drawCover(
	source: ImageBitmap,
	context: CanvasRenderingContext2D,
	width: number,
	height: number
): void {
	const scale = Math.max(width / source.width, height / source.height);
	const drawWidth = source.width * scale;
	const drawHeight = source.height * scale;
	context.drawImage(
		source,
		(width - drawWidth) / 2,
		(height - drawHeight) / 2,
		drawWidth,
		drawHeight
	);
}

/**
 * Draw `source` scaled to fit inside the canvas, centred, on transparency.
 *
 * The logo is **never cropped**. A square cover-crop of a wide wordmark
 * beheads it — the restaurant's name comes back as three letters — and the
 * manager has no way to tell from the picker that it will happen.
 */
function drawContain(
	source: ImageBitmap,
	context: CanvasRenderingContext2D,
	width: number,
	height: number
): void {
	const scale = Math.min(width / source.width, height / source.height);
	const drawWidth = source.width * scale;
	const drawHeight = source.height * scale;
	context.drawImage(
		source,
		(width - drawWidth) / 2,
		(height - drawHeight) / 2,
		drawWidth,
		drawHeight
	);
}

function canvasToBlob(
	canvas: HTMLCanvasElement,
	type: string,
	quality?: number
): Promise<Blob | null> {
	return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Encode a picked file into the bytes one slot accepts.
 *
 * Returns the *exact* pixel dimensions of the slot, because the server rejects
 * anything else: the stored width/height must describe the blob for the
 * renderer's anti-CLS attributes to mean anything.
 */
export async function encodeBrandingImage(
	file: File,
	slot: BrandingImageSlot
): Promise<BrandingEncodeResult> {
	const spec = BRANDING_SLOT_SPECS[slot];

	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
	} catch {
		// An unreadable or unsupported file (a PDF renamed to .jpg, a corrupt
		// download). Nothing to salvage, and the message the caller shows is
		// more useful than a thrown DOMException.
		return { ok: false, failure: { reason: "decodeFailed" } };
	}

	try {
		const canvas = document.createElement("canvas");
		canvas.width = spec.width;
		canvas.height = spec.height;
		const context = canvas.getContext("2d");
		if (!context) return { ok: false, failure: { reason: "encodeFailed" } };

		if (slot === "logo") drawContain(bitmap, context, spec.width, spec.height);
		else drawCover(bitmap, context, spec.width, spec.height);

		const mimeType = spec.format === "png" ? "image/png" : "image/webp";

		// PNG ignores the quality argument, so the logo gets one attempt: if a
		// 512x512 PNG exceeds 400 KB there is no knob to turn, and pretending
		// to retry would just be five identical encodes.
		const qualities: readonly (number | undefined)[] =
			spec.format === "png" ? [undefined] : QUALITY_STEPS;

		let smallest: Blob | null = null;
		for (const quality of qualities) {
			const blob = await canvasToBlob(canvas, mimeType, quality);
			if (!blob) continue;
			smallest = blob;
			if (blob.size <= spec.maxBytes) {
				return {
					ok: true,
					bytes: await blob.arrayBuffer(),
					width: spec.width,
					height: spec.height,
				};
			}
		}

		if (!smallest) return { ok: false, failure: { reason: "encodeFailed" } };
		return {
			ok: false,
			failure: {
				reason: "tooLargeAtLowestQuality",
				bytes: smallest.size,
				limitBytes: spec.maxBytes,
			},
		};
	} finally {
		// Bitmaps hold decoded pixel buffers — a 12 MP phone photo is ~48 MB.
		// Leaving several around while a manager tries different crops is how a
		// settings page runs a tab out of memory.
		bitmap.close();
	}
}

/** The three header slots, in the order a single upload fans out to them. */
export const HEADER_SLOTS: readonly BrandingImageSlot[] = [
	"headerDesktop",
	"headerTablet",
	"headerPhone",
];
