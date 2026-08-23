import type { Doc, Id } from "convex/_generated/dataModel";
import { describe, expect, it } from "vitest";
import {
	filterRestaurantsByOrganization,
	pickDefaultRestaurantId,
	resolveSelectedOrganizationId,
	resolveSelectedRestaurantId,
} from "./restaurantAdminSelection";

function mockRestaurant(
	partial: Pick<Doc<"restaurants">, "_id" | "updatedAt" | "_creationTime"> & {
		organizationId?: Id<"organizations">;
	}
): Doc<"restaurants"> {
	return {
		organizationId: "o1" as Id<"organizations">,
		...partial,
		ownerId: "u1",
		name: "R",
		slug: "r",
		currency: "MXN",
		isActive: true,
		createdAt: 0,
	} as Doc<"restaurants">;
}

describe("pickDefaultRestaurantId", () => {
	it("prefers higher updatedAt", () => {
		const a = mockRestaurant({ _id: "a" as Id<"restaurants">, updatedAt: 1, _creationTime: 100 });
		const b = mockRestaurant({ _id: "b" as Id<"restaurants">, updatedAt: 10, _creationTime: 50 });
		expect(pickDefaultRestaurantId([a, b])).toBe(b._id);
	});

	it("ties updatedAt with newer _creationTime", () => {
		const a = mockRestaurant({ _id: "a" as Id<"restaurants">, updatedAt: 5, _creationTime: 200 });
		const b = mockRestaurant({ _id: "b" as Id<"restaurants">, updatedAt: 5, _creationTime: 300 });
		expect(pickDefaultRestaurantId([a, b])).toBe(b._id);
	});
});

describe("resolveSelectedRestaurantId", () => {
	it("keeps stored id when still in list", () => {
		const r = mockRestaurant({ _id: "x" as Id<"restaurants">, updatedAt: 1, _creationTime: 1 });
		expect(resolveSelectedRestaurantId([r], "x" as Id<"restaurants">)).toBe("x");
	});

	it("falls back when stored id missing", () => {
		const r = mockRestaurant({ _id: "only" as Id<"restaurants">, updatedAt: 2, _creationTime: 2 });
		expect(resolveSelectedRestaurantId([r], "gone" as Id<"restaurants">)).toBe("only");
	});
});

const ORG_A = "orgA" as Id<"organizations">;
const ORG_B = "orgB" as Id<"organizations">;
const DIRECTORY = [{ _id: ORG_A }, { _id: ORG_B }];

describe("resolveSelectedOrganizationId", () => {
	it("keeps a stored organization that is still in the directory", () => {
		expect(resolveSelectedOrganizationId(DIRECTORY, ORG_B)).toBe(ORG_B);
	});

	it("falls back to All when the stored organization is gone", () => {
		expect(resolveSelectedOrganizationId(DIRECTORY, "orgGone" as Id<"organizations">)).toBeNull();
	});

	it("treats nothing stored as All", () => {
		expect(resolveSelectedOrganizationId(DIRECTORY, null)).toBeNull();
		// A corrupted localStorage entry reads back as an empty string.
		expect(resolveSelectedOrganizationId(DIRECTORY, "" as Id<"organizations">)).toBeNull();
	});

	it("falls back to All rather than to an empty directory's stored value", () => {
		expect(resolveSelectedOrganizationId([], ORG_A)).toBeNull();
	});
});

describe("filterRestaurantsByOrganization", () => {
	const a = mockRestaurant({
		_id: "a" as Id<"restaurants">,
		updatedAt: 1,
		_creationTime: 1,
		organizationId: ORG_A,
	});
	const b = mockRestaurant({
		_id: "b" as Id<"restaurants">,
		updatedAt: 2,
		_creationTime: 2,
		organizationId: ORG_B,
	});

	it("returns the very same array for All, so the default cannot regress", () => {
		const all = [a, b];
		expect(filterRestaurantsByOrganization(all, null)).toBe(all);
	});

	it("keeps only the selected organization's restaurants", () => {
		expect(filterRestaurantsByOrganization([a, b], ORG_A)).toEqual([a]);
		expect(filterRestaurantsByOrganization([a, b], ORG_B)).toEqual([b]);
	});

	it("yields an empty scope for an organization with no restaurants", () => {
		expect(filterRestaurantsByOrganization([a, b], "orgEmpty" as Id<"organizations">)).toEqual([]);
	});
});
