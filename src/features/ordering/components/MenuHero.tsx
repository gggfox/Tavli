/**
 * The restaurant's header image, at the top of the menu (TAVLI-97, ADR 009).
 *
 * Renders nothing at all when no header image is set — an empty band would be
 * worse than no band, and most restaurants will never upload one.
 *
 * ## Explicit width and height are load-bearing
 *
 * Tailwind preflight sets `img { height: auto }`. That is normally a kindness,
 * but it means an `<img>` the browser has not decoded yet has **no intrinsic
 * size**, so it occupies zero height and then shoves the entire menu down when
 * it lands. The stored dimensions exist for exactly this: with `width` and
 * `height` attributes the browser reserves the right box before the first byte
 * of image data arrives.
 *
 * The attributes must therefore be the *real* dimensions of the file being
 * served, which is why the upload action parses them out of the image rather
 * than trusting the client (see `convex/brandingImageHelpers.ts`).
 *
 * ## Why `<picture>` and not `srcset`
 *
 * `srcset` picks between images the browser considers interchangeable — same
 * picture, different resolutions. These are not interchangeable: a manager can
 * replace the phone slot with a tighter crop, because a 16:9 slice of a dining
 * room is mostly ceiling on a phone. That is art direction, and `<source
 * media>` is the element that expresses it.
 */
import type { PublicBranding } from "convex/brandingHelpers";

interface MenuHeroProps {
	readonly branding: PublicBranding | null;
	readonly restaurantName: string;
}

/**
 * Breakpoints matching the stored slot widths. `min-width` with the widest
 * first, because the browser takes the first `<source>` whose media matches —
 * ordering these smallest-first would serve the phone crop to everyone.
 */
const SOURCES = [
	{ key: "desktop", media: "(min-width: 1024px)" },
	{ key: "tablet", media: "(min-width: 640px)" },
] as const;

export function MenuHero({ branding, restaurantName }: Readonly<MenuHeroProps>) {
	const header = branding?.header;
	if (!header) return null;

	// The `<img>` is the fallback every `<picture>` needs and the only element
	// that actually loads. Prefer the phone crop for it: it is the smallest
	// file, and it is what a browser ignoring `<source>` (or a mail client, or
	// a scraper) will fetch.
	const fallback = header.phone ?? header.tablet ?? header.desktop;
	if (!fallback) return null;

	return (
		<div className="relative -mx-4 -mt-4 mb-2 overflow-hidden">
			<picture>
				{SOURCES.map(({ key, media }) => {
					const image = header[key];
					return image ? (
						<source
							key={key}
							media={media}
							srcSet={image.url}
							width={image.width}
							height={image.height}
						/>
					) : null;
				})}
				<img
					src={fallback.url}
					alt=""
					width={fallback.width}
					height={fallback.height}
					// `alt=""` because the name is rendered as real text below —
					// announcing it twice is noise, and this image carries no
					// information a diner needs.
					className="h-[220px] w-full object-cover"
					// The hero is the largest thing above the fold and the diner is
					// looking at it, so it is the one image on the page that must
					// not be lazy.
					loading="eager"
					fetchPriority="high"
				/>
			</picture>

			{/*
			 * A scrim rather than a solid bar: the name has to stay legible over
			 * an arbitrary photograph, and no single text colour works on both a
			 * bright sky and a dark dining room. The gradient guarantees a dark
			 * band under the text whatever is behind it.
			 */}
			<div
				className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent"
				aria-hidden
			/>
			{/*
			 * Real `<h1>` text, not text baked into the image. It is selectable,
			 * translatable, searchable, and it is what a screen reader reads —
			 * a name rendered into a photograph is invisible to all four.
			 */}
			<h1 className="absolute bottom-3 left-4 right-4 truncate text-xl font-bold text-white drop-shadow">
				{restaurantName}
			</h1>
		</div>
	);
}
