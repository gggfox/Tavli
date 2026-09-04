/**
 * Branding image validation (TAVLI-96, ADR 009).
 *
 * Pure functions over the uploaded bytes, so the rules can be tested without a
 * Convex context and so the action that calls them reads as a sequence of
 * refusals rather than a wall of parsing.
 *
 * ## Why the bytes come through a Convex action at all
 *
 * The `menuItems` template — `generateUploadUrl`, client uploads, client hands
 * back a `storageId` — is a **cross-tenant blob-delete primitive** (TAVLI-68).
 * A caller who manages restaurant A can pass a `storageId` belonging to
 * restaurant B, and the replace path, which deletes the *previous* blob,
 * deletes B's file. There is no server-side check that can retroactively make
 * a client-supplied id safe, because by then the id is the only evidence.
 *
 * Routing the bytes through an action costs one hop and buys three things the
 * other shape cannot have: the server sees the actual bytes, the server
 * assigns the `storageId`, and authorization happens before any of it.
 *
 * ## Why magic bytes and not the declared content type
 *
 * `file.type` is whatever the client says. An SVG renamed to `.png` arrives
 * claiming `image/png`, and an SVG is a script container: `<svg><script>` runs
 * when the file is served same-origin. The blob URLs Convex hands out are on
 * its own domain rather than ours, which blunts that — but "the storage host
 * happens not to be us" is a property of a vendor's CDN configuration, not a
 * security boundary we control. Sniffing the leading bytes costs four
 * comparisons and does not depend on anyone else's decisions.
 */

/** Image slots on the restaurants row. Each maps to three flat columns. */
export const BRANDING_IMAGE_SLOTS = [
	"logo",
	"headerDesktop",
	"headerTablet",
	"headerPhone",
] as const;

export type BrandingImageSlot = (typeof BRANDING_IMAGE_SLOTS)[number];

export type BrandingImageFormat = "png" | "webp";

export interface BrandingSlotSpec {
	/** Accepted format. One per slot — the client encodes to it deliberately. */
	format: BrandingImageFormat;
	/** Hard byte cap, checked before anything parses the buffer. */
	maxBytes: number;
	/** Exact pixel dimensions the client is expected to produce. */
	width: number;
	height: number;
	/** Column names on `restaurants`. */
	columns: { storageId: string; width: string; height: string };
}

/**
 * Per-slot rules.
 *
 * Dimensions are exact rather than a maximum because the client controls the
 * downscale: it renders to a canvas of exactly this size. A file that arrives
 * at some other size did not come from our uploader, and accepting it would
 * mean the stored width/height no longer describe the blob — which is the one
 * thing the renderer trusts them for.
 *
 * The three header sizes are 16:9 at breakpoint widths. Their byte caps fall
 * with their pixel count, so the phone slot cannot quietly carry a
 * desktop-weight file.
 */
export const BRANDING_SLOT_SPECS: Readonly<Record<BrandingImageSlot, BrandingSlotSpec>> = {
	// Logo is PNG, not WebP: it needs alpha against an arbitrary header
	// background, and it is small enough that WebP's advantage is noise.
	logo: {
		format: "png",
		maxBytes: 400 * 1024,
		width: 512,
		height: 512,
		columns: {
			storageId: "brandingLogoStorageId",
			width: "brandingLogoWidth",
			height: "brandingLogoHeight",
		},
	},
	headerDesktop: {
		format: "webp",
		maxBytes: 350 * 1024,
		width: 1600,
		height: 900,
		columns: {
			storageId: "brandingHeaderDesktopStorageId",
			width: "brandingHeaderDesktopWidth",
			height: "brandingHeaderDesktopHeight",
		},
	},
	headerTablet: {
		format: "webp",
		maxBytes: 200 * 1024,
		width: 1024,
		height: 576,
		columns: {
			storageId: "brandingHeaderTabletStorageId",
			width: "brandingHeaderTabletWidth",
			height: "brandingHeaderTabletHeight",
		},
	},
	headerPhone: {
		format: "webp",
		maxBytes: 120 * 1024,
		width: 768,
		height: 432,
		columns: {
			storageId: "brandingHeaderPhoneStorageId",
			width: "brandingHeaderPhoneWidth",
			height: "brandingHeaderPhoneHeight",
		},
	},
};

/** MIME type stored with the blob. Derived from the sniffed format, never from the client. */
export const CONTENT_TYPE: Readonly<Record<BrandingImageFormat, string>> = {
	png: "image/png",
	webp: "image/webp",
};

// ============================================================================
// Sniffing
// ============================================================================

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
	if (bytes.length < offset + signature.length) return false;
	return signature.every((byte, i) => bytes[offset + i] === byte);
}

/** ASCII at a fixed offset, for the RIFF/WEBP container tags. */
function tagAt(bytes: Uint8Array, offset: number, tag: string): boolean {
	if (bytes.length < offset + tag.length) return false;
	for (let i = 0; i < tag.length; i++) {
		if (bytes[offset + i] !== tag.charCodeAt(i)) return false;
	}
	return true;
}

/**
 * The format these bytes actually are, or `null`.
 *
 * Only PNG and WebP are recognised, which rejects **SVG by construction**
 * rather than by a denylist: there is no signature to add it to. A denylist
 * would need to anticipate leading whitespace, a BOM, an XML declaration, a
 * DOCTYPE, or a comment before `<svg` — five bypasses for one rule.
 */
export function sniffImageFormat(bytes: Uint8Array): BrandingImageFormat | null {
	if (startsWith(bytes, PNG_SIGNATURE)) return "png";
	// RIFF....WEBP — the length field sits between the two tags.
	if (tagAt(bytes, 0, "RIFF") && tagAt(bytes, 8, "WEBP")) return "webp";
	return null;
}

// ============================================================================
// Dimensions
// ============================================================================

export interface ImageDimensions {
	width: number;
	height: number;
}

/**
 * PNG dimensions from the IHDR chunk.
 *
 * IHDR is required by spec to be the first chunk, so its position is fixed:
 * 8-byte signature, 4-byte length, 4-byte type, then width and height as
 * big-endian uint32. Verifying the chunk type rather than trusting the offset
 * means a file that merely starts with the PNG signature cannot feed us
 * arbitrary numbers.
 */
export function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
	if (bytes.length < 24) return null;
	if (!tagAt(bytes, 12, "IHDR")) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

/**
 * WebP dimensions, across all three container flavours.
 *
 * WebP is a RIFF file whose first chunk says which flavour it is, and each
 * stores its size differently:
 *
 * - `VP8X` (extended — what a canvas `toBlob` with alpha tends to produce):
 *   24-bit little-endian *minus one*, at offset 24.
 * - `VP8L` (lossless): 14 bits each, bit-packed into a 32-bit little-endian
 *   word after a one-byte signature.
 * - `VP8 ` (lossy): 16-bit little-endian after a 10-byte frame header, with
 *   the top two bits being scaling hints rather than size.
 *
 * Handling only VP8X — the shape the ticket names — would reject the lossy
 * files most browsers actually emit for a photo, which is the common case for
 * a header image.
 */
export function readWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
	if (bytes.length < 30) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	if (tagAt(bytes, 12, "VP8X")) {
		const width = (view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16)) + 1;
		const height = (view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16)) + 1;
		return { width, height };
	}

	if (tagAt(bytes, 12, "VP8L")) {
		// 0x2f signature byte, then 14 bits width and 14 bits height, minus one.
		if (bytes[20] !== 0x2f) return null;
		const bits = view.getUint32(21, true);
		return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
	}

	if (tagAt(bytes, 12, "VP8 ")) {
		// Keyframe start code 0x9d 0x01 0x2a sits at 23..25.
		if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
		return {
			width: view.getUint16(26, true) & 0x3fff,
			height: view.getUint16(28, true) & 0x3fff,
		};
	}

	return null;
}

/** Dimensions for whichever format was sniffed. */
export function readImageDimensions(
	bytes: Uint8Array,
	format: BrandingImageFormat
): ImageDimensions | null {
	return format === "png" ? readPngDimensions(bytes) : readWebpDimensions(bytes);
}

// ============================================================================
// The whole check
// ============================================================================

export type BrandingImageRejection =
	| { reason: "tooLarge"; limitBytes: number; actualBytes: number }
	| { reason: "wrongFormat"; expected: BrandingImageFormat; actual: BrandingImageFormat | null }
	| { reason: "unreadableDimensions" }
	| { reason: "wrongDimensions"; expected: ImageDimensions; actual: ImageDimensions };

export type BrandingImageVerdict =
	| { ok: true; format: BrandingImageFormat; dimensions: ImageDimensions }
	| { ok: false; rejection: BrandingImageRejection };

/**
 * Validate uploaded bytes against a slot's spec.
 *
 * Ordered cheapest-first, and that order is deliberate: the byte cap is a
 * length comparison and runs before anything indexes into the buffer, so a
 * hostile 50 MB upload is refused without parsing a single header.
 */
export function checkBrandingImage(
	bytes: Uint8Array,
	slot: BrandingImageSlot
): BrandingImageVerdict {
	const spec = BRANDING_SLOT_SPECS[slot];

	if (bytes.byteLength > spec.maxBytes) {
		return {
			ok: false,
			rejection: { reason: "tooLarge", limitBytes: spec.maxBytes, actualBytes: bytes.byteLength },
		};
	}

	const format = sniffImageFormat(bytes);
	if (format !== spec.format) {
		return {
			ok: false,
			rejection: { reason: "wrongFormat", expected: spec.format, actual: format },
		};
	}

	const dimensions = readImageDimensions(bytes, format);
	if (dimensions === null) {
		return { ok: false, rejection: { reason: "unreadableDimensions" } };
	}

	if (dimensions.width !== spec.width || dimensions.height !== spec.height) {
		return {
			ok: false,
			rejection: {
				reason: "wrongDimensions",
				expected: { width: spec.width, height: spec.height },
				actual: dimensions,
			},
		};
	}

	return { ok: true, format, dimensions };
}
