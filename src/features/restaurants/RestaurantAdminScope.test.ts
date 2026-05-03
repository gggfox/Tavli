import type { Doc, Id } from "convex/_generated/dataModel";
import { describe, expect, it } from "vitest";
import { pickDefaultRestaurantId, resolveSelectedRestaurantId } from "./restaurantAdminSelection";

function mockRestaurant(
	partial: Pick<Doc<"restaurants">, "_id" | "updatedAt" | "_creationTime">
): Doc<"restaurants"> {
	return {
		...partial,
		ownerId: "u1",
		organizationId: "o1" as Id<"organizations">,
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
