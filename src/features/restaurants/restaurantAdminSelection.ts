import type { Doc, Id } from "convex/_generated/dataModel";

/** Newest-updated first, then Convex creation time. */
export function pickDefaultRestaurantId(restaurants: Doc<"restaurants">[]): Id<"restaurants"> {
	const sorted = [...restaurants].sort((a, b) => {
		if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
		return b._creationTime - a._creationTime;
	});
	return sorted[0]!._id;
}

export function resolveSelectedRestaurantId(
	restaurants: Doc<"restaurants">[],
	storedOrState: Id<"restaurants"> | null
): Id<"restaurants"> | null {
	if (restaurants.length === 0) return null;
	if (storedOrState && restaurants.some((r) => r._id === storedOrState)) return storedOrState;
	return pickDefaultRestaurantId(restaurants);
}

/**
 * `null` is **All organizations** — the default, and the only value that
 * reproduces the pre-switcher behavior of showing an admin every restaurant.
 *
 * A stored id that is no longer in the directory (organization deleted, or the
 * viewer lost the admin role and the tiered `getAllOrganizations` now returns a
 * narrower list) degrades to All rather than to an empty scope: the fallback
 * direction must always be "see more", never "see nothing".
 */
export function resolveSelectedOrganizationId(
	organizations: readonly { _id: Id<"organizations"> }[],
	storedOrState: Id<"organizations"> | null
): Id<"organizations"> | null {
	// Covers null and the empty string a corrupted localStorage entry can yield.
	if (!storedOrState) return null;
	return organizations.some((o) => o._id === storedOrState) ? storedOrState : null;
}

/**
 * Narrows the admin restaurant scope to one organization.
 *
 * Identity-preserving on purpose: with All selected the *same array reference*
 * comes back, so the default state is byte-for-byte today's unfiltered list and
 * cannot churn the reconciliation effect that depends on it.
 */
export function filterRestaurantsByOrganization<T extends { organizationId: Id<"organizations"> }>(
	restaurants: T[],
	organizationId: Id<"organizations"> | null
): T[] {
	if (organizationId === null) return restaurants;
	return restaurants.filter((r) => r.organizationId === organizationId);
}
