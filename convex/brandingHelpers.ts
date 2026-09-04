/**
 * Branding projection and validation helpers (TAVLI-88, ADR 009).
 *
 * The storage side is flat `branding*` columns on `restaurants` (see the
 * schema comment for why a nested column would make every stale settings tab a
 * lost-update machine). The *diner* side wants one nested object, because a
 * page either has a brand or it does not. This module is that seam.
 */
import type { Doc } from "./_generated/dataModel";
import type { StorageReader } from "convex/server";
import { normalizeBrandColor } from "./_shared/brandColor";
import { brandFontStack, resolveBrandFontId, type BrandFontId } from "./_shared/brandFonts";

/** Stable codes the frontend maps to i18n keys — never prose. */
export const BRANDING_ERROR = {
	COLOR_INVALID: "ERROR_BRANDING_COLOR_INVALID",
	IMAGE_TOO_LARGE: "ERROR_BRANDING_IMAGE_TOO_LARGE",
	IMAGE_TYPE_INVALID: "ERROR_BRANDING_IMAGE_TYPE_INVALID",
	IMAGE_DIMENSIONS_INVALID: "ERROR_BRANDING_IMAGE_DIMENSIONS_INVALID",
} as const;

export type BrandingErrorCode = (typeof BRANDING_ERROR)[keyof typeof BRANDING_ERROR];

/**
 * A resolved image. Dimensions ride along with the URL because the renderer
 * needs them at first paint: Tailwind preflight sets `img { height: auto }`,
 * which means an `<img>` with no intrinsic size *causes* the layout shift that
 * explicit width/height exists to prevent.
 */
export interface PublicBrandingImage {
	url: string;
	width: number;
	height: number;
}

export interface PublicBranding {
	/** Canonical `#rrggbb`, or absent. Consumers derive their own tokens from it. */
	color?: string;
	/** Chosen face, or absent for the system stack. */
	fontId?: BrandFontId;
	/**
	 * Resolved `--font-body` value. Sent rather than recomputed so the SSR
	 * emitter never has to reach into the font registry mid-render, and so a
	 * future font removal degrades to the system stack server-side instead of
	 * emitting a family name nothing will load.
	 */
	fontStack: string;
	logo?: PublicBrandingImage;
	/**
	 * Per-breakpoint header images for a `<picture>`. Any slot may be absent;
	 * the renderer falls back to the widest one it has.
	 */
	header?: {
		desktop?: PublicBrandingImage;
		tablet?: PublicBrandingImage;
		phone?: PublicBrandingImage;
	};
}

/** The three `branding*` column groups that hold an image, by breakpoint. */
const HEADER_SLOTS = [
	{
		key: "desktop",
		storageId: "brandingHeaderDesktopStorageId",
		width: "brandingHeaderDesktopWidth",
		height: "brandingHeaderDesktopHeight",
	},
	{
		key: "tablet",
		storageId: "brandingHeaderTabletStorageId",
		width: "brandingHeaderTabletWidth",
		height: "brandingHeaderTabletHeight",
	},
	{
		key: "phone",
		storageId: "brandingHeaderPhoneStorageId",
		width: "brandingHeaderPhoneWidth",
		height: "brandingHeaderPhoneHeight",
	},
] as const;

/**
 * Resolve one image slot to a URL + dimensions, or `undefined`.
 *
 * Returns `undefined` when the blob is gone even though the column still
 * points at it — `ctx.storage.getUrl` answers `null` for a deleted id, and a
 * diner page must render unbranded rather than emit `src="null"`.
 */
async function resolveImage(
	storage: StorageReader,
	storageId: Doc<"restaurants">["brandingLogoStorageId"],
	width: number | undefined,
	height: number | undefined
): Promise<PublicBrandingImage | undefined> {
	if (!storageId || width === undefined || height === undefined) return undefined;
	const url = await storage.getUrl(storageId);
	if (url === null) return undefined;
	return { url, width, height };
}

/**
 * Build the diner-visible branding block, or `undefined` when the restaurant
 * has set nothing — the header and hero then render nothing at all rather than
 * an empty shell, and the SSR emitter skips its `<style>` entirely.
 *
 * Composed into `restaurants.getBySlug` rather than exposed as its own query.
 * A second query would put a second round-trip on the TTFB critical path of
 * every customer page, which is the one cost this feature was explicitly
 * budgeted against.
 */
export async function resolvePublicBranding(
	storage: StorageReader,
	r: Doc<"restaurants">
): Promise<PublicBranding | undefined> {
	// Re-normalize on read. Storage is canonical because `restaurants.update`
	// normalizes on write, but this value is interpolated into an SSR'd
	// `<style>`, and a row written before that guard existed must degrade to
	// unbranded rather than reach the emitter.
	const color = normalizeBrandColor(r.brandingColor) ?? undefined;
	const fontId = resolveBrandFontId(r.brandingFontId) ?? undefined;

	const logo = await resolveImage(
		storage,
		r.brandingLogoStorageId,
		r.brandingLogoWidth,
		r.brandingLogoHeight
	);

	const header: NonNullable<PublicBranding["header"]> = {};
	for (const slot of HEADER_SLOTS) {
		const image = await resolveImage(storage, r[slot.storageId], r[slot.width], r[slot.height]);
		if (image) header[slot.key] = image;
	}
	const hasHeader = Object.keys(header).length > 0;

	if (color === undefined && fontId === undefined && logo === undefined && !hasHeader) {
		return undefined;
	}

	return {
		...(color !== undefined && { color }),
		...(fontId !== undefined && { fontId }),
		fontStack: brandFontStack(fontId),
		...(logo !== undefined && { logo }),
		...(hasHeader && { header }),
	};
}
