/**
 * Public restaurant slug derivation — pure functions, no `ctx`, unit-tested in
 * `convex/_tests/slugHelpers.test.ts`.
 *
 * The create form no longer asks an operator to invent a slug: the server
 * derives it from the restaurant name and settles collisions with a dash
 * counter (`la-cocina`, `la-cocina-2`, `la-cocina-3`, …). The slug stays
 * editable afterwards in the settings canvas, where the same normalization is
 * applied to whatever the operator types.
 *
 * Diacritics are folded rather than replaced, because this product is
 * Spanish-first: `"Café Ñoño"` has to become `cafe-nono`, not `caf--o-o`.
 *
 * The frontend imports `sanitizeSlugInput` from here so the live input and the
 * authoritative normalization cannot drift — `src/` may import `convex/`, and
 * this module pulls in nothing but `./constants`.
 */
import {
	RESTAURANT_SLUG_FALLBACK_BASE,
	RESTAURANT_SLUG_MAX_LENGTH,
	RESTAURANT_SLUG_MAX_COLLISION_ATTEMPTS,
} from "./constants";

/**
 * Stable codes the slug rules can surface (the frontend maps them to copy —
 * see `src/global/i18n/keys/errors.ts`). Lives next to the logic that raises
 * them, the way `RoleErrorMessages` lives in `convex/_util/auth.ts`.
 */
export const SLUG_ERROR = {
	/** Another live restaurant already owns this public address. */
	TAKEN: "ERROR_SLUG_TAKEN",
	/** Nothing usable survived normalization (blank, or punctuation only). */
	INVALID: "ERROR_SLUG_INVALID",
} as const;

export type SlugErrorCode = (typeof SLUG_ERROR)[keyof typeof SLUG_ERROR];

/** Combining marks NFD leaves behind: stripping them folds "ñ"→"n", "é"→"e". */
const COMBINING_MARKS = /[\u0300-\u036f]/g;
/** Every run of non-slug characters collapses to a single separator. */
const NON_SLUG_RUN = /[^a-z0-9]+/g;
const EDGE_HYPHENS = /^-+|-+$/g;
const TRAILING_HYPHENS = /-+$/g;

/** Lowercased, diacritic-free form. Shared by every function here. */
function fold(value: string): string {
	return value.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
}

/**
 * Cuts to the length cap without leaving a dangling separator, so a truncated
 * slug never renders as `/r/la-cocina-de-la-abuela-/en/menu`.
 */
function capLength(value: string): string {
	if (value.length <= RESTAURANT_SLUG_MAX_LENGTH) return value;
	return value.slice(0, RESTAURANT_SLUG_MAX_LENGTH).replace(TRAILING_HYPHENS, "");
}

/**
 * Authoritative normalization for a slug the caller supplied (settings editor,
 * API client). Returns `""` when nothing usable survives — callers reject that
 * rather than inventing a replacement, because silently renaming someone's
 * public address is worse than refusing the save.
 */
export function normalizeRestaurantSlug(value: string): string {
	return capLength(fold(value).replace(NON_SLUG_RUN, "-").replace(EDGE_HYPHENS, ""));
}

/**
 * Slug base derived from a restaurant name. Never empty: a name made entirely
 * of emoji, CJK or punctuation falls back to `RESTAURANT_SLUG_FALLBACK_BASE`,
 * which the create loop then disambiguates (`restaurant-2`, `restaurant-3`, …).
 */
export function slugifyRestaurantName(name: string): string {
	return normalizeRestaurantSlug(name) || RESTAURANT_SLUG_FALLBACK_BASE;
}

/**
 * Candidate for the nth collision attempt: `0` → `base`, `1` → `base-2`,
 * `2` → `base-3`, … The counter is never truncated — the base is — so a base
 * already at the length cap still yields distinguishable candidates.
 */
export function buildCandidateSlug(base: string, attempt: number): string {
	const safeBase = capLength(base) || RESTAURANT_SLUG_FALLBACK_BASE;
	if (attempt <= 0) return safeBase;

	const suffix = `-${attempt + 1}`;
	const room = Math.max(RESTAURANT_SLUG_MAX_LENGTH - suffix.length, 1);
	const head = safeBase.slice(0, room).replace(TRAILING_HYPHENS, "");
	return `${head || RESTAURANT_SLUG_FALLBACK_BASE.slice(0, room)}${suffix}`;
}

/**
 * Every candidate the create mutation may try, in order. Exported so the bound
 * is testable without a database.
 */
export function candidateSlugs(base: string): string[] {
	return Array.from({ length: RESTAURANT_SLUG_MAX_COLLISION_ATTEMPTS }, (_unused, attempt) =>
		buildCandidateSlug(base, attempt)
	);
}

/**
 * Lenient variant for a text input the user is still typing in. Same folding
 * and collapsing, but leading/trailing separators are kept: trimming them on
 * every keystroke would make `la-cocina` impossible to type (the `-` would
 * vanish before `c` arrives). The server normalizes properly on save.
 */
export function sanitizeSlugInput(value: string): string {
	return fold(value).replace(NON_SLUG_RUN, "-").slice(0, RESTAURANT_SLUG_MAX_LENGTH);
}
