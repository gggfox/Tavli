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
