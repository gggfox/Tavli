/**
 * Server-side branding resolution for `/r/$slug` (TAVLI-97, ADR 009).
 *
 * This is the app's first SSR Convex prefetch, and it sits on the TTFB
 * critical path of **every customer page**. Everything here exists to make
 * that acceptable.
 *
 * ## Why it resolves on the server at all
 *
 * Applying branding after hydration was rejected: the diner would watch
 * platform blue repaint into the restaurant's colour on the first frame of the
 * one screen the whole feature exists to make feel like theirs. The brand hex
 * has to be in the HTML before any JavaScript runs.
 *
 * ## Why it degrades instead of failing
 *
 * A diner mid-order does not care that Convex had a blip. An unbranded menu is
 * a minor cosmetic loss; an error page is a lost order. So every failure path
 * — timeout, throw, missing restaurant — returns `{ branding: null }`, which
 * renders exactly the pre-branding UI.
 *
 * ## Why there is a negative cache
 *
 * `restaurants.getBySlug` is unauthenticated and takes the URL path verbatim.
 * Without this, `/r/<anything>` is a free Convex query, and the SSR container
 * becomes an amplifier: one cheap HTTP request in, one database round-trip
 * out, at whatever rate someone cares to send. Remembering which slugs do not
 * exist turns the second request for a bogus slug into no query at all.
 *
 * The cache is **bounded and negative-only**. Bounded because an unbounded map
 * keyed by attacker-supplied strings is just a slower memory leak. Negative-
 * only because caching a *real* restaurant's branding would keep serving the
 * old colour for the TTL after a manager changes it, which is a support ticket
 * nobody can reproduce.
 */
import type { QueryClient } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "convex/_generated/api";
import type { PublicBranding } from "convex/brandingHelpers";

/**
 * How long the loader waits before giving up and rendering unbranded.
 *
 * Sized against what it is protecting: this runs before the first byte, so the
 * ceiling it adds to TTFB is this number. A second is long enough that a
 * healthy round-trip never trips it and short enough that a sick backend costs
 * a diner a moment rather than a page.
 */
const LOADER_TIMEOUT_MS = 1_000;

/** Slugs remembered as non-existent, and how many before the oldest is dropped. */
const NEGATIVE_CACHE_LIMIT = 500;
const NEGATIVE_CACHE_TTL_MS = 60_000;

/**
 * Module-level, which means per SSR process rather than per request — that is
 * the point, since a cache that resets every request caches nothing.
 *
 * Deliberately **not** gated behind `import.meta.env.SSR`. The server is where
 * it earns its keep (a browser can only flood itself), but the guard would buy
 * nothing: the map and its helpers ship in the client bundle either way, so
 * all it did was skip the writes — making the behaviour untestable in the
 * jsdom suite while leaving every byte of it in place. On the client it is
 * simply a small win: a 404 slug is not re-queried for a minute.
 */
const missingSlugs = new Map<string, number>();

function rememberMissing(slug: string): void {
	// Insertion order is iteration order for a Map, so the first key is the
	// oldest. Evicting one per insert keeps the bound without a sweep.
	if (missingSlugs.size >= NEGATIVE_CACHE_LIMIT) {
		const oldest = missingSlugs.keys().next();
		if (!oldest.done) missingSlugs.delete(oldest.value);
	}
	missingSlugs.set(slug, Date.now());
}

function isKnownMissing(slug: string): boolean {
	const at = missingSlugs.get(slug);
	if (at === undefined) return false;
	if (Date.now() - at > NEGATIVE_CACHE_TTL_MS) {
		// Expired. Drop it so a slug that has since been created is looked up
		// again — a restaurant that goes live must not stay invisible for the
		// life of the process.
		missingSlugs.delete(slug);
		return false;
	}
	return true;
}

/** Test seam: the cache is process-global and would leak between cases. */
export function __resetBrandingNegativeCache(): void {
	missingSlugs.clear();
}

export interface BrandingLoaderData {
	branding: PublicBranding | null;
}

const UNBRANDED: BrandingLoaderData = { branding: null };

/** Distinguishes "the query took too long" from Convex's "no such restaurant". */
const TIMED_OUT = Symbol("branding-loader-timeout");

/**
 * Resolve one restaurant's branding for the route loader.
 *
 * Uses the app's existing `ConvexQueryClient` through `ensureQueryData`, so
 * the fetch is deduped with the component-level `getBySlug` subscription and
 * nothing in `router.tsx` changes — the same query key, hydrated once.
 */
export async function loadBranding(
	queryClient: QueryClient,
	slug: string
): Promise<BrandingLoaderData> {
	if (isKnownMissing(slug)) return UNBRANDED;

	try {
		const options = convexQuery(api.restaurants.getBySlug, { slug });
		const restaurant = await Promise.race([
			queryClient.ensureQueryData(options),
			// A distinct sentinel, **not** `null`. Convex answers `null` for "no
			// such restaurant", so a timeout resolving `null` would be
			// indistinguishable from a definite miss — and would poison the
			// negative cache for a restaurant that exists but was briefly slow,
			// leaving it unbranded for the whole TTL with nothing to explain it.
			//
			// Resolving rather than rejecting because a timeout is a
			// *degradation*, not an error: rejecting would only mean catching it
			// below to produce the same value.
			new Promise<typeof TIMED_OUT>((resolve) =>
				setTimeout(() => resolve(TIMED_OUT), LOADER_TIMEOUT_MS)
			),
		]);

		if (restaurant === TIMED_OUT || restaurant === undefined) return UNBRANDED;

		if (restaurant === null) {
			// A definite "no such restaurant" — the only answer worth
			// remembering, and the one that makes `/r/<random>` cheap.
			rememberMissing(slug);
			return UNBRANDED;
		}

		return { branding: restaurant.branding ?? null };
	} catch {
		// A Convex blip degrades to unbranded, never to an error page for a
		// diner mid-order.
		return UNBRANDED;
	}
}
